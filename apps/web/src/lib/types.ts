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

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
