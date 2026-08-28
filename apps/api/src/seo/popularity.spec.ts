import { FRESH_WINDOW_DAYS, rankByActivity, rankStream } from './popularity';

const NOW = new Date('2026-08-28T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('popularity', () => {
  describe('rankByActivity', () => {
    it('прячет организацию без единого эфира — пустая страница в индексе только вредит', () => {
      const rank = rankByActivity({ isLive: false, finishedBroadcasts: 0, lastBroadcastAt: null }, NOW);
      expect(rank.indexable).toBe(false);
    });

    it('живой эфир — максимальный приоритет и hourly', () => {
      const rank = rankByActivity({ isLive: true, finishedBroadcasts: 0, lastBroadcastAt: null }, NOW);
      expect(rank).toMatchObject({ indexable: true, priority: 0.9, changeFrequency: 'hourly' });
      expect(rank.lastModified).toEqual(NOW);
    });

    it('эфир на днях — 0.7/daily, lastmod по последнему эфиру', () => {
      const last = daysAgo(3);
      const rank = rankByActivity({ isLive: false, finishedBroadcasts: 5, lastBroadcastAt: last }, NOW);
      expect(rank).toMatchObject({ indexable: true, priority: 0.7, changeFrequency: 'daily' });
      expect(rank.lastModified).toEqual(last);
    });

    it(`эфиры были, но давнее ${FRESH_WINDOW_DAYS} дней — 0.5/weekly, но из индекса не выкидываем`, () => {
      const rank = rankByActivity(
        { isLive: false, finishedBroadcasts: 2, lastBroadcastAt: daysAgo(FRESH_WINDOW_DAYS + 1) },
        NOW,
      );
      expect(rank).toMatchObject({ indexable: true, priority: 0.5, changeFrequency: 'weekly' });
    });

    it('граница окна свежести считается свежей', () => {
      const rank = rankByActivity(
        { isLive: false, finishedBroadcasts: 1, lastBroadcastAt: daysAgo(FRESH_WINDOW_DAYS) },
        NOW,
      );
      expect(rank.priority).toBe(0.7);
    });
  });

  describe('rankStream', () => {
    it('страница отдельного стрима весит на 0.1 меньше страницы организации', () => {
      const activity = { isLive: true, finishedBroadcasts: 0, lastBroadcastAt: null };
      expect(rankStream(activity, NOW).priority).toBe(0.8);
      expect(rankByActivity(activity, NOW).priority).toBe(0.9);
    });

    it('неиндексируемый остаётся неиндексируемым, приоритет не уходит в минус', () => {
      const rank = rankStream({ isLive: false, finishedBroadcasts: 0, lastBroadcastAt: null }, NOW);
      expect(rank.indexable).toBe(false);
      expect(rank.priority).toBe(0);
    });
  });
});
