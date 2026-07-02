/**
 * Карточка каталога (backend: `GET /v1/public/orgs`) — одна на орг.
 * Ссылка → `/watch/<orgSlug>` (обзор орги).
 */
export interface CatalogOrgCard {
  orgSlug: string;
  orgName: string;
  liveCount: number;
  previewMode: string;
  hasCustomPreview: boolean;
  /** slug репрезентативного Stream'а для построения per-stream thumbnail URL; null — нет публичных Stream'ов. */
  representativeStreamSlug: string | null;
}

export type CatalogItem = CatalogOrgCard;

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
