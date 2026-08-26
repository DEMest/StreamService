/**
 * Скользящее окно «не более N попаданий по ключу за период», в памяти процесса.
 *
 * Redis сюда не нужен: api однопроцессный (как и per-streamId мьютекс в
 * StreamService), а после рестарта счётчики честно обнуляются — потерять
 * час защиты от спама не страшно, потерять обращение о падающем эфире страшно.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep = 0;

  /** Полная чистка карты не чаще раза в минуту — она O(ключей). */
  private static readonly SWEEP_INTERVAL_MS = 60_000;

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    /** Предохранитель от разрастания карты при флуде с уникальных адресов. */
    private readonly maxKeys = 10_000,
  ) {}

  /**
   * @returns true — попадание засчитано, действие разрешено.
   *          false — лимит по ключу исчерпан, ничего не засчитано.
   */
  tryHit(key: string, now = Date.now()): boolean {
    this.sweep(now);

    const fresh = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (fresh.length >= this.max) {
      // Записываем подчищенный список: иначе просроченные отметки живут в
      // памяти до следующего sweep, хотя уже ни на что не влияют.
      this.hits.set(key, fresh);
      return false;
    }

    fresh.push(now);
    this.hits.set(key, fresh);
    return true;
  }

  /** Сколько попаданий по ключу ещё доступно в текущем окне. */
  remaining(key: string, now = Date.now()): number {
    const fresh = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    return Math.max(0, this.max - fresh.length);
  }

  private sweep(now: number): void {
    const overgrown = this.hits.size > this.maxKeys;
    if (!overgrown && now - this.lastSweep < SlidingWindowLimiter.SWEEP_INTERVAL_MS) return;
    this.lastSweep = now;

    for (const [key, times] of this.hits) {
      const fresh = times.filter((t) => now - t < this.windowMs);
      if (fresh.length === 0) this.hits.delete(key);
      else this.hits.set(key, fresh);
    }

    // Живых ключей всё ещё слишком много — это флуд с уникальных адресов.
    // Держать их все в памяти опаснее, чем обнулить счётчики: общий потолок
    // (второй лимитер с единственным ключом) от спама всё равно прикрывает.
    if (this.hits.size > this.maxKeys) this.hits.clear();
  }
}
