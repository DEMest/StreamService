import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export type StreamMode = 'composite' | 'multistream';

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

  /**
   * Возвращает массив MediaMTX-путей (без `live/` префикса) для Stream'а.
   * - composite: один путь = streamBasePath
   * - multistream: N путей = streamBasePath/1..N
   */
  pathsForStream(orgSlug: string, streamSlug: string, mode: StreamMode, slotCount: number): string[] {
    const base = this.streamBasePath(orgSlug, streamSlug);
    if (mode === 'composite') return [base];
    const paths: string[] = [];
    for (let n = 1; n <= slotCount; n++) paths.push(`${base}/${n}`);
    return paths;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Public API — *StreamPaths (новые методы; Step 3+)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Создать все пути Stream'а в MediaMTX с общим passphrase.
   * Идемпотентно: если путь существует — патчит (replace) его passphrase.
   */
  async addStreamPaths(
    orgSlug: string,
    streamSlug: string,
    mode: StreamMode,
    slotCount: number,
    ingestKey: string,
    record?: boolean,
  ): Promise<void> {
    const paths = this.pathsForStream(orgSlug, streamSlug, mode, slotCount);
    await Promise.all(paths.map((p) => this.addSinglePath(p, ingestKey, record)));
  }

  /**
   * Переключить запись для всех путей Stream'а без затирания passphrase.
   * Использует MediaMTX PATCH endpoint — затрагивает только поле `record`.
   */
  async setStreamRecording(
    orgSlug: string,
    streamSlug: string,
    mode: StreamMode,
    slotCount: number,
    enabled: boolean,
  ): Promise<void> {
    const paths = this.pathsForStream(orgSlug, streamSlug, mode, slotCount);
    await Promise.all(
      paths.map((p) => this.patchSinglePath(p, { record: enabled })),
    );
  }

  /**
   * Перезаписать (replace) passphrase всех путей Stream'а. Используется при rotate-key.
   */
  async replaceStreamPaths(
    orgSlug: string,
    streamSlug: string,
    mode: StreamMode,
    slotCount: number,
    ingestKey: string,
  ): Promise<void> {
    const paths = this.pathsForStream(orgSlug, streamSlug, mode, slotCount);
    await Promise.all(paths.map((p) => this.replaceSinglePath(p, ingestKey)));
  }

  /**
   * Удалить все пути Stream'а. Для multistream — N путей; для composite — один.
   */
  async deleteStreamPaths(
    orgSlug: string,
    streamSlug: string,
    mode: StreamMode,
    slotCount: number,
  ): Promise<void> {
    const paths = this.pathsForStream(orgSlug, streamSlug, mode, slotCount);
    await Promise.all(paths.map((p) => this.deleteSinglePath(p)));
  }

  /**
   * Diff-обновление путей Stream'а:
   *  - вычисляем old paths (по oldMode/oldSlotCount) и new paths (по newMode/newSlotCount)
   *  - удаляем только те, которые исчезли
   *  - добавляем только новые
   *  - existing пути не трогаем (их passphrase уже валидна; ключ не меняется этим методом)
   *
   * Для смены passphrase используйте replaceStreamPaths.
   */
  async updateStreamPaths(
    orgSlug: string,
    streamSlug: string,
    oldMode: StreamMode,
    newMode: StreamMode,
    oldSlotCount: number,
    newSlotCount: number,
    ingestKey: string,
  ): Promise<void> {
    const oldPaths = new Set(this.pathsForStream(orgSlug, streamSlug, oldMode, oldSlotCount));
    const newPaths = new Set(this.pathsForStream(orgSlug, streamSlug, newMode, newSlotCount));

    const toDelete: string[] = [];
    const toAdd: string[] = [];
    for (const p of oldPaths) if (!newPaths.has(p)) toDelete.push(p);
    for (const p of newPaths) if (!oldPaths.has(p)) toAdd.push(p);

    // Удаляем сначала, потом добавляем — чтобы при смене mode (composite→multistream)
    // освободить slug перед регистрацией новых путей.
    await Promise.all(toDelete.map((p) => this.deleteSinglePath(p)));
    await Promise.all(toAdd.map((p) => this.addSinglePath(p, ingestKey)));
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Runtime introspection
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Возвращает список активных MediaMTX путей. Используется при старте API для
   * реконсиляции SlotState (см. SlotStateService.onModuleInit) — если процесс
   * упал во время живой публикации, мы получаем актуальное состояние от
   * MediaMTX, а не ждём следующего publish-webhook.
   *
   * Поля item'а в ответе v3/paths/list: `name` (например `live/club/2`) и
   * `ready` — true если по пути идёт активная публикация прямо сейчас.
   */
  async listActivePaths(): Promise<Array<{ name: string; ready: boolean }>> {
    const res = await axios.get(`${this.base}/v3/paths/list`, { auth: this.auth });
    const items = res.data?.items ?? [];
    return items.map((it: any) => ({ name: String(it?.name ?? ''), ready: !!it?.ready }));
  }

  /**
   * Возвращает список путей, на которые СЕЙЧАС идёт публикация — с учётом
   * runtime-источников. В отличие от {@link listActivePaths}, не зависит от
   * того, был ли path заранее добавлен через `/v3/config/paths/add`: если
   * vMix/OBS пушат на путь, который mediamtx принял через `pathDefaults`,
   * он не будет в `paths/list`, но окажется в `srtconns/list` /
   * `rtspsessions/list` / `rtmpconns/list` со `state='publish'`.
   *
   * Используется в reconcile при старте API (см. SlotStateService.onModuleInit):
   * после рестарта api/mediamtx configured-paths могут быть потеряны (mediamtx
   * хранит их в RAM), но рантайм-публикация продолжает идти — без этого метода
   * UI остался бы пустым до следующего publish/unpublish цикла.
   *
   * Дедуплицирует по path-имени и помечает ready=true.
   */
  async listActivePublishers(): Promise<Array<{ name: string; ready: boolean }>> {
    const fetchPath = async (endpoint: string) => {
      try {
        const r = await axios.get(`${this.base}${endpoint}`, { auth: this.auth });
        return r.data?.items ?? [];
      } catch (err: any) {
        // mediamtx может вернуть 404 если endpoint выключен. Это не критично —
        // другие источники всё равно покрывают свои протоколы.
        this.logger.warn(`MediaMTX ${endpoint} failed: ${err.message}`);
        return [];
      }
    };

    const [paths, srtConns, rtspSessions, rtmpConns] = await Promise.all([
      fetchPath('/v3/paths/list'),
      fetchPath('/v3/srtconns/list'),
      fetchPath('/v3/rtspsessions/list'),
      fetchPath('/v3/rtmpconns/list'),
    ]);

    const names = new Set<string>();

    // 1) Configured paths с ready=true.
    for (const it of paths) {
      if (it?.ready && typeof it.name === 'string') names.add(it.name);
    }

    // 2) Runtime коннекшены (только те, что в state='publish').
    //    SRT/RTMP-conn возвращают `path`; rtspsessions — тоже `path`.
    const collectConn = (items: any[]) => {
      for (const it of items) {
        if (!it) continue;
        const state = String(it.state ?? '');
        const path = typeof it.path === 'string' ? it.path : '';
        if (state === 'publish' && path.length > 0) names.add(path);
      }
    };
    collectConn(srtConns);
    collectConn(rtspSessions);
    collectConn(rtmpConns);

    return Array.from(names).map((name) => ({ name, ready: true }));
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
