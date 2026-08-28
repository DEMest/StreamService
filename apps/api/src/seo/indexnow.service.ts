import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { publicSiteUrl } from './site-url';

/**
 * IndexNow — общий протокол мгновенного уведомления поисковиков об изменении
 * страницы. Один POST на api.indexnow.org раздаётся всем участникам сразу:
 * Яндекс, Bing, Seznam, Naver. Google в IndexNow не участвует — для него есть
 * отдельный GoogleIndexingService.
 *
 * Ключ **публичен по дизайну протокола**: он лежит открытым текстовым файлом
 * на самом сайте (`/<key>.txt`), и именно этот файл доказывает поисковику, что
 * уведомление шлёт владелец домена. Поэтому он захардкожен здесь и лежит
 * рядом в `apps/web/public/` — секретом он не является, знание ключа позволяет
 * посторонему разве что попросить переобход наших же страниц.
 *
 * Меняя ключ, меняйте ОБА места — иначе поисковик не найдёт файл и молча
 * отбросит уведомления (HTTP 403).
 */
export const INDEXNOW_KEY = 'd057e92b56ad2893b9b710fb39f8da49';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const TIMEOUT_MS = 5_000;

@Injectable()
export class IndexNowService {
  private readonly logger = new Logger(IndexNowService.name);

  /** Ключ можно переопределить через env — тогда и файл на сайте должен быть другой. */
  private get key(): string {
    return (process.env.INDEXNOW_KEY ?? '').trim() || INDEXNOW_KEY;
  }

  get enabled(): boolean {
    return publicSiteUrl() !== null;
  }

  /**
   * Уведомить об изменении списка URL (абсолютных, на нашем домене).
   *
   * Никогда не бросает: пинг поисковику — побочный эффект вокруг эфира, и
   * упавший индексатор не должен ронять обработку webhook'а от MediaMTX.
   */
  async submit(urls: string[]): Promise<boolean> {
    const site = publicSiteUrl();
    if (!site || urls.length === 0) return false;

    const host = new URL(site).host;
    const key = this.key;

    try {
      const res = await axios.post(
        ENDPOINT,
        {
          host,
          key,
          keyLocation: `${site}/${key}.txt`,
          urlList: urls,
        },
        {
          timeout: TIMEOUT_MS,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          // 4xx разбираем сами (нужен текст ошибки в лог), а не через throw.
          validateStatus: () => true,
        },
      );

      // 200 — принято, 202 — принято, ключ ещё проверяется.
      if (res.status === 200 || res.status === 202) {
        this.logger.log(`IndexNow: отправлено ${urls.length} URL (${res.status})`);
        return true;
      }
      this.logger.warn(`IndexNow отклонил запрос: HTTP ${res.status} ${JSON.stringify(res.data ?? '')}`);
      return false;
    } catch (e: any) {
      this.logger.warn(`IndexNow недоступен: ${e?.message ?? e}`);
      return false;
    }
  }
}
