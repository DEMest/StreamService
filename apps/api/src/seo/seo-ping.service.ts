import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleIndexingService } from './google-indexing.service';
import { IndexNowService } from './indexnow.service';
import { publicSiteUrl } from './site-url';

/**
 * Уведомление поисковиков о том, что страница трансляции изменилась: эфир
 * начался или закончился.
 *
 * Вызывается из обработчика webhook'а MediaMTX (StreamService), поэтому здесь
 * жёсткое правило: **ничего не бросать и ничего не ждать**. Эфир не должен
 * зависеть от доступности Яндекса и Google, поэтому наружу торчит синхронный
 * `streamStateChanged`, который только запускает работу в фоне.
 *
 * Троттлинг на 10 минут — защита от «мигающего» ингеста: оборвавшийся SRT
 * присылает publish/unpublish десятками, а квота Google Indexing API — 200
 * URL в сутки по умолчанию.
 */

const THROTTLE_MS = 10 * 60_000;

@Injectable()
export class SeoPingService {
  private readonly logger = new Logger(SeoPingService.name);
  /** Ключ — `<получатель>:<url>`, значение — момент последней отправки. */
  private readonly lastPing = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private indexNow: IndexNowService,
    private google: GoogleIndexingService,
  ) {}

  /**
   * Эфир на Stream'е стартовал или завершился. Возврат — сразу; вся сетевая
   * работа уходит в фон.
   */
  streamStateChanged(streamId: string): void {
    if (!publicSiteUrl()) return;
    void this.notify(streamId).catch((e) =>
      this.logger.warn(`SEO ping для ${streamId} не прошёл: ${e?.message ?? e}`),
    );
  }

  /** Та же работа, но с ожиданием — для тестов и ручных прогонов. */
  async notify(streamId: string): Promise<void> {
    const site = publicSiteUrl();
    if (!site) return;

    const stream = await this.prisma.stream.findUnique({
      where: { id: streamId },
      select: {
        slug: true,
        isPublic: true,
        org: { select: { slug: true, isActive: true } },
      },
    });
    // Приватные стримы и отключённые организации в индекс не идут вовсе.
    if (!stream || !stream.isPublic || !stream.org.isActive) return;

    const streamUrl = `${site}/watch/${stream.org.slug}/${stream.slug}`;

    // IndexNow: сама трансляция и списки, где она появляется/исчезает.
    const candidates = [streamUrl, `${site}/watch/${stream.org.slug}`, `${site}/streams`, `${site}/`];
    const fresh = candidates.filter((url) => this.allow('indexnow', url));
    if (fresh.length > 0) await this.indexNow.submit(fresh);

    // Google Indexing API принимает только страницы с BroadcastEvent —
    // каталог и лендинг сюда слать нельзя (см. GoogleIndexingService).
    if (this.google.enabled && this.allow('google', streamUrl)) {
      await this.google.publish(streamUrl, 'URL_UPDATED');
    }
  }

  /**
   * Пропускает URL не чаще раза в THROTTLE_MS и попутно чистит просроченные
   * записи, чтобы карта не росла бесконечно на долгоживущем процессе.
   */
  private allow(target: 'indexnow' | 'google', url: string): boolean {
    const now = Date.now();
    for (const [key, at] of this.lastPing) {
      if (now - at > THROTTLE_MS) this.lastPing.delete(key);
    }

    const key = `${target}:${url}`;
    const last = this.lastPing.get(key);
    if (last !== undefined && now - last < THROTTLE_MS) return false;

    this.lastPing.set(key, now);
    return true;
  }
}
