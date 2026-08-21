import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class MediamtxService {
  private readonly logger = new Logger(MediamtxService.name);
  private readonly base = process.env.MEDIAMTX_API_URL ?? 'http://localhost:9997';
  private readonly auth = {
    username: process.env.MEDIAMTX_API_USER ?? 'api',
    password: process.env.MEDIAMTX_API_PASS ?? 'mediamtxpass',
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Path builders
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Базовый MediaMTX-путь для Stream'а (без `live/` префикса и без slot-индекса).
   * - default Stream орги (streamSlug='') → '<orgSlug>'
   * - named Stream → '<orgSlug>/<streamSlug>'
   */
  private streamBasePath(orgSlug: string, streamSlug: string): string {
    return streamSlug === '' ? orgSlug : `${orgSlug}/${streamSlug}`;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Public API — *StreamPaths
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Создать путь Stream'а в MediaMTX с passphrase.
   * Идемпотентно: если путь существует — патчит (replace) его passphrase.
   */
  async addStreamPaths(orgSlug: string, streamSlug: string, ingestKey: string, record?: boolean): Promise<void> {
    await this.addSinglePath(this.streamBasePath(orgSlug, streamSlug), ingestKey, record);
  }

  /**
   * Переключить запись для пути Stream'а без затирания passphrase.
   * Использует MediaMTX PATCH endpoint — затрагивает только поле `record`.
   */
  async setStreamRecording(orgSlug: string, streamSlug: string, enabled: boolean): Promise<void> {
    await this.patchSinglePath(this.streamBasePath(orgSlug, streamSlug), { record: enabled });
  }

  /**
   * Перезаписать (replace) passphrase пути Stream'а. Используется при rotate-key.
   * `record` передаётся ОБЯЗАТЕЛЬНО из БД вызывающей стороной: replace затирает
   * весь per-path конфиг, и без явного record путь сбросился бы на глобальный
   * default mediamtx.yml вопреки настройке Stream'а.
   */
  async replaceStreamPaths(orgSlug: string, streamSlug: string, ingestKey: string, record?: boolean): Promise<void> {
    await this.replaceSinglePath(this.streamBasePath(orgSlug, streamSlug), ingestKey, record);
  }

  /**
   * Удалить путь Stream'а из MediaMTX.
   */
  async deleteStreamPaths(orgSlug: string, streamSlug: string): Promise<void> {
    await this.deleteSinglePath(this.streamBasePath(orgSlug, streamSlug));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Низкоуровневые helpers для одного пути
  // ────────────────────────────────────────────────────────────────────────────

  private async addSinglePath(
    path: string,
    passphrase: string,
    record?: boolean,
  ): Promise<void> {
    const body: Record<string, unknown> = { srtPublishPassphrase: passphrase };
    if (record !== undefined) body.record = record;
    try {
      await axios.post(
        `${this.base}/v3/config/paths/add/live/${path}`,
        body,
        { auth: this.auth },
      );
    } catch (err: any) {
      // Путь уже существует — патчим через replace
      if (err.response?.status === 400) {
        await this.replaceSinglePath(path, passphrase, record);
      } else {
        this.logger.warn(`MediaMTX addPath failed for ${path}: ${err.message}`);
        throw err;
      }
    }
  }

  private async replaceSinglePath(
    path: string,
    passphrase: string,
    record?: boolean,
  ): Promise<void> {
    const body: Record<string, unknown> = { srtPublishPassphrase: passphrase };
    if (record !== undefined) body.record = record;
    try {
      await axios.post(
        `${this.base}/v3/config/paths/replace/live/${path}`,
        body,
        { auth: this.auth },
      );
    } catch (err: any) {
      this.logger.warn(`MediaMTX patchPath failed for ${path}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Patch single path config (партиальное обновление) — для toggle записи
   * без затирания passphrase. См. MediaMTX API:
   * PATCH /v3/config/paths/patch/<name>
   */
  private async patchSinglePath(
    path: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    try {
      await axios.patch(
        `${this.base}/v3/config/paths/patch/live/${path}`,
        body,
        { auth: this.auth },
      );
    } catch (err: any) {
      this.logger.warn(`MediaMTX patchPath failed for ${path}: ${err.message}`);
      throw err;
    }
  }

  private async deleteSinglePath(path: string): Promise<void> {
    try {
      await axios.delete(
        `${this.base}/v3/config/paths/delete/live/${path}`,
        { auth: this.auth },
      );
    } catch (err: any) {
      this.logger.warn(`MediaMTX deletePath failed for ${path}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Пути, по которым прямо сейчас идёт публикация (`ready: true`).
   * Источник правды о том, что в эфире: БД знает только то, что ей сообщили
   * вебхуки, а вебхук может не дойти — например, если api лежал в момент
   * unpublish. Возвращает имена БЕЗ префикса `live/`.
   *
   * Бросает при недоступности MediaMTX: пустой Set неотличим от «все
   * отключились», а по нему вызывающий код закрывает эфиры.
   */
  async listReadyPaths(): Promise<Set<string>> {
    const { data } = await axios.get(`${this.base}/v3/paths/list`, {
      auth: this.auth,
      timeout: 5000,
      params: { itemsPerPage: 1000 },
    });
    // Успешный, но не тот ответ (прокси, редирект, обрезанный JSON) не должен
    // молча превращаться в «никто не публикует» — по такому ответу вызывающий
    // код закрывает эфиры.
    if (!Array.isArray(data?.items)) {
      throw new Error('MediaMTX /v3/paths/list вернул неожиданный ответ');
    }
    if (typeof data.pageCount === 'number' && data.pageCount > 1) {
      throw new Error(`MediaMTX /v3/paths/list не поместился на страницу (pageCount=${data.pageCount})`);
    }
    const ready = new Set<string>();
    for (const item of data.items) {
      if (item?.ready && typeof item.name === 'string') {
        ready.add(item.name.replace(/^live\//, ''));
      }
    }
    return ready;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Deprecated wrappers (backward-compat для legacy кода до Step 3)
  // Новый код должен использовать *StreamPaths методы.
  // ────────────────────────────────────────────────────────────────────────────

  /** @deprecated Используйте addStreamPaths. */
  async addPath(path: string, passphrase: string): Promise<void> {
    return this.addSinglePath(path, passphrase);
  }

  /** @deprecated Используйте replaceStreamPaths. */
  async patchPath(path: string, passphrase: string): Promise<void> {
    return this.replaceSinglePath(path, passphrase);
  }

  /** @deprecated Используйте deleteStreamPaths. */
  async deletePath(path: string): Promise<void> {
    return this.deleteSinglePath(path);
  }
}
