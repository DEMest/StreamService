import { parseAccessLogLine } from './nginx-log';

describe('parseAccessLogLine', () => {
  const seg =
    '2026-08-29T14:03:11+03:00|200|1048576|0.004|HIT|/api/v1/public/orgs/club/streams/court-a/live/hls/p720/seg17.ts';

  it('разбирает запрос сегмента', () => {
    const e = parseAccessLogLine(seg)!;
    expect(e.status).toBe(200);
    expect(e.bytes).toBe(1048576);
    expect(e.requestMs).toBe(4);
    expect(e.cache).toBe('hit');
    expect(e.orgSlug).toBe('club');
    expect(e.streamSlug).toBe('court-a');
    expect(e.rendition).toBe('p720');
    expect(e.kind).toBe('segment');
    expect(e.at).toBe(Date.parse('2026-08-29T14:03:11+03:00'));
  });

  it('отличает плейлист от сегмента', () => {
    const e = parseAccessLogLine(
      '2026-08-29T14:03:11+03:00|200|812|0.001|MISS|/api/v1/public/orgs/club/streams/court-a/live/hls/master.m3u8',
    )!;
    expect(e.kind).toBe('playlist');
    expect(e.rendition).toBeNull();
    expect(e.cache).toBe('miss');
  });

  it('не теряет запрос из-за ключа приватного стрима в адресе', () => {
    const e = parseAccessLogLine(
      '2026-08-29T14:03:11+03:00|200|999|0.002|HIT|/api/v1/public/orgs/club/streams/court-a/live/hls/hd/seg1.ts?key=abc',
    )!;
    expect(e.rendition).toBe('hd');
    expect(e.kind).toBe('segment');
  });

  it('помечает прочерк кэша как other, а не как промах', () => {
    const e = parseAccessLogLine(
      '2026-08-29T14:03:11+03:00|404|0|0.001|-|/api/v1/public/orgs/club/streams/nope/live/hls/hd/seg1.ts',
    )!;
    expect(e.cache).toBe('other');
    expect(e.status).toBe(404);
  });

  it('возвращает null на мусоре и на чужих адресах', () => {
    expect(parseAccessLogLine('')).toBeNull();
    expect(parseAccessLogLine('одно|два')).toBeNull();
    expect(parseAccessLogLine('2026-08-29T14:03:11+03:00|200|10|0.1|-|/dashboard')).toBeNull();
  });

  it('переживает неизвестный каталог качества', () => {
    const e = parseAccessLogLine(
      '2026-08-29T14:03:11+03:00|200|10|0.1|HIT|/api/v1/public/orgs/club/streams/a/live/hls/p1080/seg1.ts',
    )!;
    expect(e.rendition).toBeNull();
    expect(e.kind).toBe('segment');
  });

  it('узнаёт дефолтный стрим с пустым slug', () => {
    const e = parseAccessLogLine(
      '2026-08-29T14:03:11+03:00|200|500|0.001|HIT|/api/v1/public/orgs/club/streams//live/hls/hd/seg1.ts',
    )!;
    expect(e.orgSlug).toBe('club');
    expect(e.streamSlug).toBe('');
    expect(e.rendition).toBe('hd');
  });
});
