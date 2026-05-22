/**
 * Карточка каталога (backend: `GET /v1/public/orgs`).
 *
 * Step 5 ввёл Event-сущность — каталог теперь возвращает discriminated union:
 *   - `type: 'stream'` — обычная карточка одного Stream'а (default или named).
 *     Ссылка → `/watch/<orgSlug>[/streamSlug]`.
 *   - `type: 'event'` — карточка активного Event'а с ≥2 live-public Stream'ами.
 *     Ссылка → `/event/<orgSlug>/<eventSlug>` (landing со списком Stream'ов).
 *
 * Все live-public Stream'ы Event'а «съедаются» Event-карточкой и не светятся
 * standalone — см. PublicService.getCatalog логика в backend'е.
 */

export interface CatalogStreamCard {
  type: 'stream';
  orgSlug: string;
  orgName: string;
  streamSlug: string;
  streamName: string;
  isLive: boolean;
  previewMode: string;
  hasCustomPreview: boolean;
}

export interface CatalogEventCard {
  type: 'event';
  orgSlug: string;
  orgName: string;
  eventSlug: string;
  eventTitle: string;
  /** Slug'и live-public Stream'ов Event'а — для построения thumbnail-коллажа. */
  streamSlugs: string[];
  /** previewMode первого Stream'а в Event'е — для fallback одиночного thumbnail. */
  previewMode: string;
  /**
   * Все public Stream'ы Event'а (live + offline), скрытые из standalone-
   * раздела каталога. Архив берёт оттуда список Stream'ов для запроса
   * broadcasts — иначе stream'ы, спрятанные Event-карточкой, потеряли бы
   * свой архив. См. Karen H3 (Step 5).
   */
  consumedStreams: CatalogStreamCard[];
}

export type CatalogItem = CatalogStreamCard | CatalogEventCard;

/**
 * @deprecated — legacy-имя для CatalogStreamCard. Сохранено для обратной
 * совместимости с уже импортирующими модулями (`OrgCard.tsx`); новый код
 * должен использовать `CatalogStreamCard` или `CatalogItem`.
 */
export type CatalogOrg = CatalogStreamCard;

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';
