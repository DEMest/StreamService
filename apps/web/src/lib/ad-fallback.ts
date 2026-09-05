/**
 * Фолбэк-оформление рекламы без своей картинки: градиент + инициалы
 * заголовка. Палитра — вне брендового красного (иначе реклама читалась бы
 * как LIVE-индикатор) и вне палитры OrgAvatar (иначе — как ещё одна орга).
 */
const AD_GRADIENTS: Array<[string, string]> = [
  ['#2563eb', '#1e3a8a'],
  ['#059669', '#065f46'],
  ['#7c3aed', '#4c1d95'],
  ['#d97706', '#78350f'],
];

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export function adGradient(adId: string): string {
  const [from, to] = AD_GRADIENTS[hashSeed(adId) % AD_GRADIENTS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

export function adInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
