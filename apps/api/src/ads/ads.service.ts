import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ImageService } from '../storage/image.service';
import { AD_MANAGER_ROLE, type JwtPayload } from '../auth/auth.service';

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

/**
 * Целевой размер картинки под плейсмент — стандартные IAB-форматы, а не
 * произвольная пропорция: рекламодатели присылают уже готовый баннер под
 * конкретный размер, а не фото для кропа. watch — Medium Rectangle (300×250,
 * стандарт для оверлея поверх видео), catalog — Leaderboard (728×90,
 * стандартная полоса над контентом). Должно совпадать с `spec` в
 * AD_IMAGE_SPECS (apps/web/src/app/admin/ads/page.tsx) — иначе подсказанный
 * админу размер разойдётся с тем, что реально ждёт сервер.
 */
const PLACEMENT_IMAGE_SIZE: Record<AdPlacement, { width: number; height: number }> = {
  watch: { width: 300, height: 250 },
  catalog: { width: 728, height: 90 },
};

const TITLE_MAX = 120;
const SUBTITLE_MAX = 200;
const URL_MAX = 500;

/**
 * Рекламные плейсхолдеры — платформенная фича, а не инструмент организации:
 * создатель ролика доверенный, поэтому валидация здесь лёгкая (длины полей +
 * схема ссылки), а не как у публичных форм.
 *
 * Экран управления один (/admin/ads), но видит его каждая роль по-своему —
 * см. `seesEverything`.
 */
@Injectable()
export class AdsService {
  private readonly logger = new Logger(AdsService.name);

  constructor(
    private prisma: PrismaService,
    private images: ImageService,
  ) {}

  /**
   * Видит ли `user` всю рекламу платформы.
   *
   * Рекламный менеджер — да, суперадмин — только заведённую им самим. Это
   * бизнес-требование, а не разграничение прав: экран у обеих ролей один и тот
   * же, разной делается только выборка. Единственное место, где это решается,
   * — сведи его к двум, и роли начнут расходиться по разным методам.
   */
  private seesEverything(user: JwtPayload): boolean {
    return user.role === AD_MANAGER_ROLE;
  }

  // ── Админка ──────────────────────────────────────────────────────────

  listAdmin(user: JwtPayload) {
    return this.prisma.ad.findMany({
      where: this.seesEverything(user) ? {} : { ownerId: user.sub },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(dto: CreateAdDto, user: JwtPayload) {
    if (typeof dto?.title !== 'string' || !dto.title.trim()) {
      throw new BadRequestException('title: обязательное поле');
    }
    if (typeof dto?.targetUrl !== 'string' || !dto.targetUrl.trim()) {
      throw new BadRequestException('targetUrl: обязательное поле');
    }
    return this.prisma.ad.create({
      data: { ...(normalize(dto) as CreateAdDto), ownerId: user.sub },
    });
  }

  async update(id: string, dto: UpdateAdDto, user: JwtPayload) {
    await this.requireAd(id, user);
    try {
      return await this.prisma.ad.update({ where: { id }, data: normalize(dto) });
    } catch (e: any) {
      if (e.code === 'P2025') throw new NotFoundException(`Ad '${id}' not found`);
      throw e;
    }
  }

  async remove(id: string, user: JwtPayload): Promise<{ ok: true }> {
    const ad = await this.requireAd(id, user);
    if (ad.imagePathWatch) await this.images.delete(ad.imagePathWatch);
    if (ad.imagePathCatalog) await this.images.delete(ad.imagePathCatalog);
    await this.prisma.ad.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * `mimetype === 'image/gif'` идёт отдельным путём: анимация сохраняется
   * (выход всегда webp — JPEG анимировать не умеет), но кроп на входе не
   * применяется (canvas-кроппер видит только один кадр), поэтому картинка
   * только вписывается в размер (см. ImageService.uploadAnimated).
   *
   * Расширение хранимого ключа меняется в зависимости от формата
   * (.jpg / .webp) — если у объявления уже была картинка другого формата
   * под этим плейсментом, старый файл в S3 не переживёт замену и его нужно
   * подчистить отдельно, иначе он останется висеть мусором.
   */
  async uploadImage(
    id: string,
    placement: AdPlacement,
    buffer: Buffer,
    mimetype: string,
    user: JwtPayload,
  ) {
    const ad = await this.requireAd(id, user);
    const { width, height } = PLACEMENT_IMAGE_SIZE[placement];
    const animated = mimetype === 'image/gif';
    const key = `images/ad/${id}-${placement}.${animated ? 'webp' : 'jpg'}`;

    if (animated) {
      await this.images.uploadAnimated(key, buffer, width, height);
    } else {
      // contain, не cover: это готовый баннер рекламодателя, обрезать его нельзя.
      await this.images.upload(key, buffer, width, height, 'contain');
    }

    const oldKey = ad[PLACEMENT_FIELD[placement]];
    if (oldKey && oldKey !== key) await this.images.delete(oldKey);

    return this.prisma.ad.update({ where: { id }, data: { [PLACEMENT_FIELD[placement]]: key } });
  }

  async deleteImage(id: string, placement: AdPlacement, user: JwtPayload) {
    const ad = await this.requireAd(id, user);
    const key = ad[PLACEMENT_FIELD[placement]];
    if (key) await this.images.delete(key);
    return this.prisma.ad.update({ where: { id }, data: { [PLACEMENT_FIELD[placement]]: null } });
  }

  /**
   * Насколько реклама навязчива: показы против того, чем закончился просмотр.
   * Кликов нет по замыслу — ссылку рекламодателя не мы измеряем.
   */
  async stats(id: string, user: JwtPayload) {
    await this.requireAd(id, user);
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

  async serveImage(id: string, placement: AdPlacement): Promise<{ buffer: Buffer; contentType: string } | null> {
    const ad = await this.prisma.ad.findUnique({
      where: { id },
      select: { imagePathWatch: true, imagePathCatalog: true },
    });
    const key = ad?.[PLACEMENT_FIELD[placement]];
    if (!key) return null;
    const buffer = await this.images.serve(key);
    if (!buffer) return null;
    // Формат зашит в расширение ключа (см. uploadImage) — отдельного поля в
    // базе под это заводить незачем, S3-ключ уже несёт эту информацию.
    return { buffer, contentType: key.endsWith('.webp') ? 'image/webp' : 'image/jpeg' };
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

  /**
   * Объявление, к которому у `user` есть доступ.
   *
   * Чужое для суперадмина — 404, а не 403: существование чужой записи не
   * подтверждаем (тот же приём, что у межтенантных проверок в /v1/org/*).
   * Через эту одну точку проходят update / remove / uploadImage /
   * deleteImage / stats — добавляя шестой метод, зови её же.
   */
  private async requireAd(id: string, user: JwtPayload) {
    const ad = await this.prisma.ad.findUnique({ where: { id } });
    if (!ad) throw new NotFoundException(`Ad '${id}' not found`);
    if (!this.seesEverything(user) && ad.ownerId !== user.sub) {
      throw new NotFoundException(`Ad '${id}' not found`);
    }
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
