export type AdPlacement = 'watch' | 'catalog';
export type AdEventKind = 'impression' | 'dismiss_timeout' | 'dismiss_no_reason' | 'dismiss_reason';

/**
 * Событие показа/закрытия рекламы — как QoE-телеметрия (useQoeBeacon): сырой
 * fetch с keepalive, потому что ручка отвечает 204 без тела, а общий
 * api.post() ждёт JSON в ответе и упал бы на пустом теле.
 */
export function sendAdEvent(
  adId: string,
  placement: AdPlacement,
  kind: AdEventKind,
  reason: string | null,
): void {
  void fetch(`/api/v1/public/ads/${adId}/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placement, kind, reason }),
    keepalive: true,
  }).catch(() => {});
}
