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

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
