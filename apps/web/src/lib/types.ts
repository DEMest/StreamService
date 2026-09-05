/**
 * Карточка каталога (backend: `GET /v1/public/orgs`) — одна на орг.
 * Превью карточки — картинка орги (`/v1/public/orgs/<slug>/image`), если
 * загружена; стримовые thumbnail'ы на карточках не используются.
 */
export interface CatalogOrgCard {
  orgSlug: string;
  orgName: string;
  liveCount: number;
  hasImage: boolean;
}

export type CatalogItem = CatalogOrgCard;

/**
 * Элемент плоского глобального архива (backend: `GET /v1/public/broadcasts`) —
 * питает `/archive`: все записи всех публичных Stream'ов сразу, от новых к
 * старым, без выбора орги/Stream'а.
 */
export interface ArchiveFeedItem {
  id: string;
  title: string;
  description: string | null;
  startedAt: string;
  endedAt: string | null;
  hasPreview: boolean;
  recording: {
    id: string;
    status: string;
    fileSize: number | null;
    duration: number | null;
  } | null;
  orgSlug: string;
  orgName: string;
  streamSlug: string;
  streamName: string;
}

/**
 * Активное рекламное объявление (backend: `GET /v1/public/ads`). Картинка —
 * своя на каждый плейсмент; `null` — клиент рисует градиент с инициалами
 * заголовка (см. `lib/ad-fallback.ts`).
 */
export interface PublicAd {
  id: string;
  title: string;
  subtitle: string | null;
  targetUrl: string;
  watchImageUrl: string | null;
  catalogImageUrl: string | null;
}

/** Объявление в админке (backend: `GET /v1/admin/ads`) — с внутренними полями. */
export interface AdminAd {
  id: string;
  title: string;
  subtitle: string | null;
  targetUrl: string;
  isActive: boolean;
  sortOrder: number;
  imagePathWatch: string | null;
  imagePathCatalog: string | null;
  createdAt: string;
}

/** Статистика назойливости объявления (backend: `GET /v1/admin/ads/:id/stats`). */
export interface AdStats {
  impressions: number;
  dismissed: number;
  dismissTimeout: number;
  dismissNoReason: number;
  reasons: Record<string, number>;
  dismissRate: number;
}

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
