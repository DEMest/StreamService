import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImageService } from '../storage/image.service';

export type AdPlacement = 'watch' | 'catalog';
export type AdEventKind = 'impression' | 'dismiss_timeout' | 'dismiss_no_reason' | 'dismiss_reason';

export const AD_EVENT_KINDS: AdEventKind[] = [
  'impression',
  'dismiss_timeout',
  'dismiss_no_reason',
  'dismiss_reason',
];

export interface CreateAdDto {
  title: string;
  subtitle?: string | null;
  targetUrl: string;
  isActive?: boolean;
  sortOrder?: number;
}

export type UpdateAdDto = Partial<CreateAdDto>;

const PLACEMENT_FIELD: Record<AdPlacement, 'imagePathWatch' | 'imagePathCatalog'> = {
  watch: 'imagePathWatch',
  catalog: 'imagePathCatalog',
};

const TITLE_MAX = 120;
const SUBTITLE_MAX = 200;
const URL_MAX = 500;

/**
 * Рекламные плейсхолдеры — платформенная фича одного суперадмина, а не
 * инструмент организации: создатель ролика доверенный, поэтому валидация
 * здесь лёгкая (длины полей + схема ссылки), а не как у публичных форм.
 */
@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    private prisma: PrismaService,
    private images: ImageService,
  ) {}

  // ── Админка ──────────────────────────────────────────────────────────

  listAdmin() {
    return this.prisma.ad.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async create(dto: CreateAdDto) {
    if (typeof dto?.title !== 'string' || !dto.title.trim()) {
      throw new BadRequestException('title: обязательное поле');
    }
    if (typeof dto?.targetUrl !== 'string' || !dto.targetUrl.trim()) {
      throw new BadRequestException('targetUrl: обязательное поле');
    }
    return this.prisma.ad.create({ data: normalize(dto) as CreateAdDto });
  }

  async update(id: string, dto: UpdateAdDto) {
    await this.requireAd(id);
    try {
      return await this.prisma.ad.update({ where: { id }, data: normalize(dto) });
    } catch (e: any) {
      if (e.code === 'P2025') throw new NotFoundException(`Ad '${id}' not found`);
      throw e;
    }
  }

  async remove(id: string): Promise<{ ok: true }> {
    const ad = await this.requireAd(id);
    if (ad.imagePathWatch) await this.images.delete(ad.imagePathWatch);
    if (ad.imagePathCatalog) await this.images.delete(ad.imagePathCatalog);
    await this.prisma.ad.delete({ where: { id } });
    return { ok: true };
  }

  async uploadImage(id: string, placement: AdPlacement, buffer: Buffer) {
    await this.requireAd(id);
    const key = `images/ad/${id}-${placement}.jpg`;
    await this.images.upload(key, buffer);
    return this.prisma.ad.update({ where: { id }, data: { [PLACEMENT_FIELD[placement]]: key } });
  }

  async deleteImage(id: string, placement: AdPlacement) {
    const ad = await this.requireAd(id);
    const key = ad[PLACEMENT_FIELD[placement]];
    if (key) await this.images.delete(key);
    return this.prisma.ad.update({ where: { id }, data: { [PLACEMENT_FIELD[placement]]: null } });
  }

  /**
   * Насколько реклама навязчива: показы против того, чем закончился просмотр.
   * Кликов нет по замыслу — ссылку рекламодателя не мы измеряем.
   */
  async stats(id: string) {
    await this.requireAd(id);
    const rows = await this.prisma.adEvent.groupBy({
      by: ['kind', 'reason'],
      where: { adId: id },
      _count: true,
    });

    let impressions = 0;
    let dismissTimeout = 0;
    let dismissNoReason = 0;
    const reasons: Record<string, number> = {};

    for (const row of rows) {
      const count = row._count;
      // switch, а не if/else: если в AdEventKind появится новый вид события,
      // TypeScript откажется собирать код, пока для него не найдётся ветка —
      // новый kind не должен молча выпадать из статистики.
      const kind = row.kind as AdEventKind;
      switch (kind) {
        case 'impression':
          impressions += count;
          break;
        case 'dismiss_timeout':
          dismissTimeout += count;
          break;
        case 'dismiss_no_reason':
          dismissNoReason += count;
          break;
        case 'dismiss_reason':
          if (row.reason) reasons[row.reason] = (reasons[row.reason] ?? 0) + count;
          break;
        default: {
          const exhaustive: never = kind;
          void exhaustive;
        }
      }
    }

    const dismissedWithReason = Object.values(reasons).reduce((a, b) => a + b, 0);
    const dismissed = dismissTimeout + dismissNoReason + dismissedWithReason;

    return {
      impressions,
      dismissed,
      dismissTimeout,
      dismissNoReason,
      reasons,
      // Доля показов, закрытых до конца — то самое «насколько навязчиво».
      dismissRate: impressions > 0 ? dismissed / impressions : 0,
    };
  }

  // ── Публичная сторона ────────────────────────────────────────────────

  async listActive() {
    const ads = await this.prisma.ad.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        title: true,
        subtitle: true,
        targetUrl: true,
        imagePathWatch: true,
        imagePathCatalog: true,
      },
    });

    return ads.map((ad) => ({
      id: ad.id,
      title: ad.title,
      subtitle: ad.subtitle,
      targetUrl: ad.targetUrl,
      watchImageUrl: ad.imagePathWatch ? `/v1/public/ads/${ad.id}/image/watch` : null,
      catalogImageUrl: ad.imagePathCatalog ? `/v1/public/ads/${ad.id}/image/catalog` : null,
    }));
  }

  async serveImage(id: string, placement: AdPlacement): Promise<Buffer | null> {
    const ad = await this.prisma.ad.findUnique({
      where: { id },
      select: { imagePathWatch: true, imagePathCatalog: true },
    });
    const key = ad?.[PLACEMENT_FIELD[placement]];
    if (!key) return null;
    return this.images.serve(key);
  }

  /**
   * Публичная ручка без авторизации — зовёт анонимный браузер зрителя.
   * Мусорный/устаревший adId (закрытая вкладка, снятая с показа реклама)
   * не должен возвращать ошибку тому, кто его не выбирал.
   */
  async recordEvent(
    adId: string,
    placement: AdPlacement,
    kind: AdEventKind,
    reason: string | null,
  ): Promise<void> {
    try {
      await this.prisma.adEvent.create({
        data: { adId, placement, kind, reason: kind === 'dismiss_reason' ? reason : null },
      });
    } catch (e: any) {
      // FK на уже удалённое/снятое с показа объявление — отчёт зрителя не тот
      // случай, когда стоит превращать это в ошибку публичного эндпоинта.
      // Всё остальное (обрыв БД, баг) молча теряться не должно — иначе
      // статистика в /admin/ads просто замрёт без единого следа в логах.
      if (e?.code !== 'P2003') {
        this.logger.warn(`Failed to record ad event for ${adId}: ${e?.message ?? e}`);
      }
    }
  }

  private async requireAd(id: string) {
    const ad = await this.prisma.ad.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException(`Ad '${id}' not found`);
    return ad;
  }
}

function normalize(dto: UpdateAdDto): UpdateAdDto {
  const data: UpdateAdDto = {};

  if (dto.title !== undefined) {
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('title: не может быть пустым');
    if (title.length > TITLE_MAX) throw new BadRequestException(`title: не длиннее ${TITLE_MAX} символов`);
    data.title = title;
  }

  if (dto.subtitle !== undefined) {
    const subtitle = dto.subtitle?.trim() || null;
    if (subtitle && subtitle.length > SUBTITLE_MAX) {
      throw new BadRequestException(`subtitle: не длиннее ${SUBTITLE_MAX} символов`);
    }
    data.subtitle = subtitle;
  }

  if (dto.targetUrl !== undefined) {
    const targetUrl = dto.targetUrl.trim();
    // Ссылка рендерится на публичном сайте как обычный href — без проверки
    // схемы `javascript:...` было бы хранимой XSS через форму админки.
    if (!/^https?:\/\//i.test(targetUrl)) {
      throw new BadRequestException('targetUrl: должен начинаться с http:// или https://');
    }
    if (targetUrl.length > URL_MAX) throw new BadRequestException(`targetUrl: не длиннее ${URL_MAX} символов`);
    data.targetUrl = targetUrl;
  }

  if (dto.isActive !== undefined) data.isActive = !!dto.isActive;
  if (dto.sortOrder !== undefined) data.sortOrder = Number(dto.sortOrder) || 0;

  return data;
}
