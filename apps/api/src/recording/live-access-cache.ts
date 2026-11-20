import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StreamVisibility } from '../stream/stream-access';

/**
 * Режим доступа Stream'а для раздачи live HLS: снимает запрос в Postgres с
 * каждого сегмента и плейлиста.
 *
 * Пять секунд устаревания здесь недопустимы в одну сторону — после закрытия
 * трансляции старый адрес не должен отдать ни одного нового сегмента. Поэтому
 * смена режима сбрасывает кэш сразу (`invalidate`), а TTL страхует только от
 * правок мимо StreamService.
 */
@Injectable()
export class LiveAccessCache {
  private static readonly TTL_MS = 5000;
  private readonly entries = new Map<string, StreamVisibility & { expires: number }>();
  // Растёт на каждом invalidate: чтение из БД, начатое ДО смены режима и
  // закончившееся ПОСЛЕ, не должно вернуть в кэш прежний режим ещё на 5 секунд.
  private generation = 0;

  constructor(private prisma: PrismaService) {}

  async get(orgSlug: string, streamSlug: string): Promise<StreamVisibility | null> {
    const cacheKey = `${orgSlug}/${streamSlug}`;
    const now = Date.now();
    const hit = this.entries.get(cacheKey);
    if (hit && hit.expires > now) return hit;
    if (hit) this.entries.delete(cacheKey);

    const generation = this.generation;
    const stream = await this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug, isActive: true } },
      select: { isPublic: true, previewKey: true },
    });
    // Несуществующие стримы НЕ кэшируем — иначе перебор slug'ов раздувает Map.
    if (!stream) return null;

    const visibility: StreamVisibility = { isPublic: stream.isPublic, previewKey: stream.previewKey ?? null };
    if (generation === this.generation) {
      this.entries.set(cacheKey, { ...visibility, expires: now + LiveAccessCache.TTL_MS });
    }
    return visibility;
  }

  /** Смена режима или ключа любого Stream'а. Режим меняют редко — сбрасываем всё. */
  invalidate(): void {
    this.generation += 1;
    this.entries.clear();
  }
}
