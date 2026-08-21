import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import { PrismaService } from '../prisma/prisma.service';
import {
  RecordingService,
  RECORDINGS_ROOT,
  RECORDING_RETENTION_DAYS,
} from '../recording/recording.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ImageService } from '../storage/image.service';
import { ARCHIVE_OVERHEAD, hourlyRate, hoursLeft } from './storage-estimate';
import { IngestConfigDto, readIngestConfig } from './ingest-config';

/**
 * Метрика хранилища для дашборда орги (`GET /v1/org/storage`).
 *
 * `disk` — null в двух РАЗНЫХ случаях, поэтому рядом идёт `diskStatus`: без
 * него фронт не мог отличить «архив во внешнем S3, места мы не меряем» от
 * «мерить не удалось», и во втором случае показывал орге заведомую неправду.
 */
export type DiskStatus = 'ok' | 'external' | 'unavailable';

export interface OrgStorageDto {
  disk: { totalBytes: number; freeBytes: number } | null;
  diskStatus: DiskStatus;
  archive: { usedBytes: number; recordingsCount: number; durationSeconds: number };
  estimate: {
    bytesPerHour: number;
    bitrateMbps: number;
    /** true — расход посчитан по записям самой орги, false — по дефолтному битрейту. */
    fromHistory: boolean;
    /** Часов записи до исчерпания свободного места; null — когда disk===null. */
    hoursLeft: number | null;
  };
  retentionDays: number;
}

/**
 * Архив лежит в MinIO из этого же docker-стека (том `minio_data` на том же
 * LVM-разделе, что и `recordings_data`), поэтому statfs по `/recordings`
 * показывает ровно тот запас, в который упрётся заливка записи. Если
 * `S3_ENDPOINT` указывает на внешнего провайдера — связи больше нет.
 *
 * Разбираем именно hostname, а не строку целиком: имя сервиса в compose может
 * быть и `minio`, и `streamservice-minio` — regex по всему URL на втором
 * варианте молча давал false и метрика исчезала без единого лога.
 */
function isLocalS3(): boolean {
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) return false;
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  // Внешний провайдер всегда приходит FQDN'ом с точками, docker-имя сервиса —
  // всегда одна метка. Так `minio.s3-provider.com` не будет принят за свой.
  if (hostname.includes('.')) return false;
  // `minio`, `streamservice-minio`, `minio-1`, `minio2`.
  return /(^|-)minio[-\d]*$/.test(hostname);
}

/**
 * OrgService — только org-уровневые операции. Всё, что раньше делегировалось
 * в «default Stream» (ingest/recording/preview/per-stream chat) теперь живёт
 * на StreamController/StreamService для КАЖДОГО Stream'а орги индивидуально.
 */
@Injectable()
export class OrgService {
  private readonly logger = new Logger(OrgService.name);

  constructor(
    private prisma: PrismaService,
    private recording: RecordingService,
    private chatGateway: ChatGateway,
    private images: ImageService,
  ) {}

  /**
   * GET /v1/org/ingest-config — адрес и порты для энкодера.
   *
   * Данные общие для всего стенда, org-скоуп тут только из-за расположения:
   * потребитель — дашборд орги. Читаем env на каждый запрос, а не кешируем в
   * поле: значения меняются вместе с перезапуском контейнера, а лишний
   * process.env на фоне похода в БД у соседних ручек ничего не стоит.
   */
  getIngestConfig(): IngestConfigDto {
    return readIngestConfig(process.env, (msg) => this.logger.warn(msg));
  }

  async getProfile(orgId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        slug: true,
        name: true,
        isActive: true,
        createdAt: true,
        chatTtlMinutes: true,
        chatEnabled: true,
        imagePath: true,
      },
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  /**
   * GET /v1/org/storage — занятое место архива орги + свободное место на диске
   * сервера + прогноз «сколько ещё часов записи влезет». Нужен орге, чтобы до
   * начала трансляции понимать, поместится ли она.
   *
   * Считаем только `status='ready'`: у processing/failed `fileSize` ещё NULL,
   * а их scratch живёт в `/recordings`, а не в архиве.
   */
  async getStorage(orgId: string): Promise<OrgStorageDto> {
    const agg = await this.prisma.recording.aggregate({
      where: { status: 'ready', broadcast: { stream: { orgId } } },
      _sum: { fileSize: true, duration: true },
      _count: { _all: true },
    });

    // fileSize учитывает только slot-N/; в S3 рядом лежит ещё download.mp4
    // такого же размера — отсюда ARCHIVE_OVERHEAD (см. storage-estimate.ts).
    // Number() — _sum по BigInt-колонке возвращает bigint, а дальше идёт
    // обычная арифметика и JSON-ответ (BigInt не сериализуется).
    const usedBytes = Number(agg._sum.fileSize ?? 0) * ARCHIVE_OVERHEAD;
    const durationSeconds = agg._sum.duration ?? 0;

    const { disk, diskStatus } = this.readDiskStats();
    const rate = hourlyRate(usedBytes, durationSeconds);

    return {
      disk,
      diskStatus,
      archive: {
        usedBytes,
        recordingsCount: agg._count._all,
        durationSeconds,
      },
      estimate: {
        bytesPerHour: rate.bytesPerHour,
        bitrateMbps: Math.round(rate.bitrateMbps * 10) / 10,
        fromHistory: rate.fromHistory,
        hoursLeft: disk ? hoursLeft(disk.freeBytes, rate.bytesPerHour) : null,
      },
      retentionDays: RECORDING_RETENTION_DAYS,
    };
  }

  /**
   * Свободное место тома, на котором лежит архив.
   *
   * `bavail` (а не `bfree`) — блоки, доступные непривилегированному процессу:
   * ext4 резервирует ~5% под root, и записать их сервис всё равно не сможет.
   * Из `totalBytes` этот же root-резерв вычитается, иначе процент занятого
   * расходится с тем, что показывает `df` (38% против 36%).
   */
  private readDiskStats(): {
    disk: { totalBytes: number; freeBytes: number } | null;
    diskStatus: DiskStatus;
  } {
    if (!isLocalS3()) return { disk: null, diskStatus: 'external' };
    try {
      const st = fs.statfsSync(RECORDINGS_ROOT);
      const rootReserved = st.bfree - st.bavail;
      return {
        disk: {
          totalBytes: (st.blocks - rootReserved) * st.bsize,
          freeBytes: st.bavail * st.bsize,
        },
        diskStatus: 'ok',
      };
    } catch (err: any) {
      // Не 500-им весь дашборд из-за метрики: на dev-машине без /recordings
      // (api запущен вне docker) statfs кинет ENOENT — это штатная ситуация.
      this.logger.warn(`statfs(${RECORDINGS_ROOT}) failed: ${err?.message ?? err}`);
      return { disk: null, diskStatus: 'unavailable' };
    }
  }

  /**
   * `name` — отображаемое имя орги (уникально в БД, независимо от логина/slug).
   * P2002 при занятом имени → 409.
   */
  async updateSettings(orgId: string, data: { name?: string; chatTtlMinutes?: number; chatEnabled?: boolean }) {
    const orgData: Record<string, any> = {};
    if (data.name !== undefined) orgData.name = data.name.trim();
    if (data.chatTtlMinutes !== undefined) orgData.chatTtlMinutes = data.chatTtlMinutes;
    if (data.chatEnabled !== undefined) orgData.chatEnabled = data.chatEnabled;

    let updated;
    try {
      updated = await this.prisma.organization.update({
        where: { id: orgId },
        data: orgData,
        select: { slug: true, name: true, chatTtlMinutes: true, chatEnabled: true },
      });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException(`Name '${orgData.name}' already taken`);
      throw e;
    }

    if (data.chatEnabled !== undefined) {
      this.chatGateway.broadcastChatEnabled(updated.slug, updated.chatEnabled);
    }
    return updated;
  }

  /**
   * Tenant-scoped по принадлежности Stream'у этой орги (не по конкретному
   * «главному» Stream'у — раньше искало только у default Stream'а, из-за чего
   * update/delete 404-ились для broadcast'ов именованных Stream'ов).
   */
  async updateBroadcast(orgId: string, broadcastId: string, data: { title?: string; description?: string }) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, stream: { orgId } },
    });
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    return this.prisma.broadcast.update({
      where: { id: broadcastId },
      data,
      select: { id: true, title: true, description: true },
    });
  }

  async deleteBroadcast(orgId: string, broadcastId: string) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, stream: { orgId } },
    });
    if (!broadcast) throw new NotFoundException('Broadcast not found');
    await this.recording.deleteRecordingByBroadcastId(broadcastId);
    await this.prisma.broadcast.delete({ where: { id: broadcastId } });
    return { ok: true };
  }

  /**
   * Ручная замена превью записи (перезапись того же S3-ключа, по которому
   * финализация кладёт авто-кадр). Ключ живёт под префиксом записи —
   * удаляется вместе с ней. Tenant-scope как у updateBroadcast: 404 для чужих.
   */
  async uploadBroadcastPreview(orgId: string, broadcastId: string, fileBuffer: Buffer): Promise<{ ok: true }> {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, stream: { orgId } },
      select: { id: true, stream: { select: { slug: true, org: { select: { slug: true } } } } },
    });
    if (!broadcast?.stream) throw new NotFoundException('Broadcast not found');
    const { stream } = broadcast;
    // Паритет с retryFailed: slug='' — легаси default-Stream, путь без сегмента стрима.
    const basePath = stream.slug === '' ? stream.org.slug : `${stream.org.slug}/${stream.slug}`;
    const key = `archive/${basePath}/${broadcastId}/preview.jpg`;
    await this.images.upload(key, fileBuffer);
    await this.prisma.broadcast.update({
      where: { id: broadcastId },
      data: { previewImagePath: key },
    });
    return { ok: true };
  }

  /**
   * Картинка организации — показывается на карточках каталога/архива.
   * Хранится в S3 (`images/org/<orgId>.jpg`), перезапись по тому же ключу.
   */
  async uploadImage(orgId: string, fileBuffer: Buffer): Promise<{ ok: true }> {
    const key = `images/org/${orgId}.jpg`;
    await this.images.upload(key, fileBuffer);
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { imagePath: key },
    });
    return { ok: true };
  }

  async deleteImage(orgId: string): Promise<{ ok: true }> {
    await this.images.delete(`images/org/${orgId}.jpg`);
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { imagePath: null },
    });
    return { ok: true };
  }
}
