/**
 * Карточка каталога (backend: `GET /v1/public/orgs`).
 * Один Stream = одна карточка. Ссылка → `/watch/<orgSlug>[/streamSlug]`.
 */
export interface CatalogStreamCard {
  orgSlug: string;
  orgName: string;
  streamSlug: string;
  streamName: string;
  isLive: boolean;
  previewMode: string;
  hasCustomPreview: boolean;
}

export type CatalogItem = CatalogStreamCard;

/**
 * @deprecated — legacy-имя для CatalogStreamCard. Сохранено для обратной
 * совместимости с уже импортирующими модулями (`OrgCard.tsx`); новый код
 * должен использовать `CatalogStreamCard` или `CatalogItem`.
 */
export type CatalogOrg = CatalogStreamCard;

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
