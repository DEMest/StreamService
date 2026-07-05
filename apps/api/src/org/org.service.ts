import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ImageService } from '../storage/image.service';

/**
 * OrgService — только org-уровневые операции. Всё, что раньше делегировалось
 * в «default Stream» (ingest/recording/preview/per-stream chat) теперь живёт
 * на StreamController/StreamService для КАЖДОГО Stream'а орги индивидуально.
 */
@Injectable()
export class OrgService {
  constructor(
    private prisma: PrismaService,
    private recording: RecordingService,
    private chatGateway: ChatGateway,
    private images: ImageService,
  ) {}

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
