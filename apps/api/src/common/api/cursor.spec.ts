import { ApiException } from './api-error';
import { decodeCursor, encodeCursor, toCursorPage } from './cursor';

type Position = { id: string; seq: number };
const isPosition = (v: unknown): v is Position =>
  typeof v === 'object' && v !== null && typeof (v as Position).id === 'string' && typeof (v as Position).seq === 'number';

describe('cursor', () => {
  it('позиция переживает кодирование и годится для адреса', () => {
    const raw = encodeCursor({ id: 'ck1/+=', seq: 7 });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(raw, isPosition)).toEqual({ id: 'ck1/+=', seq: 7 });
  });

  it.each([
    ['мусор', '%%%'],
    ['посторонние символы после позиции', encodeCursor({ id: 'r1', seq: 1 }) + '%%%'],
    ['лишний padding', encodeCursor({ id: 'r1', seq: 1 }) + '='],
    ['не JSON', Buffer.from('not json').toString('base64url')],
    ['чужая форма', encodeCursor({ other: 1 })],
    ['пустой', ''],
  ])('%s → 400 INVALID_CURSOR', (_name, raw) => {
    try {
      decodeCursor(raw, isPosition);
      throw new Error('должно было бросить');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiException);
      expect((e as ApiException).getStatus()).toBe(400);
      expect((e as ApiException).getResponse()).toMatchObject({ code: 'INVALID_CURSOR' });
    }
  });

  describe('toCursorPage', () => {
    const rows = [1, 2, 3, 4, 5].map((seq) => ({ id: `r${seq}`, seq }));

    it('строк больше лимита: отдаёт лимит и курсор на последнюю отданную', () => {
      const page = toCursorPage(rows, 3, (r) => ({ id: r.id, seq: r.seq }));
      expect(page.items.map((r) => r.seq)).toEqual([1, 2, 3]);
      expect(decodeCursor(page.nextCursor!, isPosition)).toEqual({ id: 'r3', seq: 3 });
    });

    it('строк не больше лимита: последняя порция', () => {
      expect(toCursorPage(rows, 5, (r) => ({ id: r.id }))).toEqual({ items: rows, nextCursor: null });
      expect(toCursorPage([], 5, () => ({}))).toEqual({ items: [], nextCursor: null });
    });
  });
});
