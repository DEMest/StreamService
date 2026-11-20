import { canServeMedia, canView, mediaUrlPrefix, newPreviewKey, previewKeyMatches } from './stream-access';

const PUBLIC = { isPublic: true, previewKey: null };
const PRIVATE = { isPublic: false, previewKey: 'k'.repeat(64) };

describe('stream-access', () => {
  it('newPreviewKey — 64 hex-символа (256 бит), каждый раз новый', () => {
    const a = newPreviewKey();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newPreviewKey()).not.toBe(a);
  });

  it('previewKeyMatches: пустые и разной длины — false', () => {
    expect(previewKeyMatches(null, 'x')).toBe(false);
    expect(previewKeyMatches('x', undefined)).toBe(false);
    expect(previewKeyMatches('', '')).toBe(false);
    expect(previewKeyMatches('abc', 'abcd')).toBe(false);
    expect(previewKeyMatches('abc', 'abc')).toBe(true);
  });

  it('canView: публичный — всем (лишний ключ не мешает), приватный — только с ключом', () => {
    expect(canView(PUBLIC)).toBe(true);
    expect(canView(PUBLIC, 'stale')).toBe(true);
    expect(canView(PRIVATE)).toBe(false);
    expect(canView(PRIVATE, 'nope')).toBe(false);
    expect(canView(PRIVATE, PRIVATE.previewKey)).toBe(true);
  });

  it('canServeMedia: адрес обязан совпадать с режимом', () => {
    // Обычный адрес
    expect(canServeMedia(PUBLIC, undefined)).toBe(true);
    expect(canServeMedia(PRIVATE, undefined)).toBe(false);
    // Адрес с ключом
    expect(canServeMedia(PRIVATE, PRIVATE.previewKey)).toBe(true);
    expect(canServeMedia(PRIVATE, 'nope')).toBe(false);
    expect(canServeMedia(PUBLIC, 'anything')).toBe(false);
    // Приватный без ключа в БД (битое состояние) не открывается ничем
    expect(canServeMedia({ isPublic: false, previewKey: null }, 'null')).toBe(false);
  });

  it('mediaUrlPrefix: именованный и дефолтный Stream, публичный и приватный', () => {
    expect(mediaUrlPrefix('club', 'court', PUBLIC)).toBe('/api/v1/public/orgs/club/streams/court');
    expect(mediaUrlPrefix('club', 'court', PRIVATE)).toBe(`/api/v1/public/orgs/club/streams/court/private/${PRIVATE.previewKey}`);
    expect(mediaUrlPrefix('club', '', PUBLIC)).toBe('/api/v1/public/orgs/club');
    expect(mediaUrlPrefix('club', '', PRIVATE)).toBe(`/api/v1/public/orgs/club/private/${PRIVATE.previewKey}`);
  });
});
