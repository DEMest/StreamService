import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import { parseFfmpegProgress } from './ffmpeg-progress';
import { StatsSample, StreamStatsSnapshot } from './stats.types';

/** Шаг опроса MediaMTX. 2 с — «реальное время» на глаз, но 30 запросов/мин, а не 120. */
const POLL_INTERVAL_MS = 2_000;
/** Глубина графика: 300 точек × 2 с = 10 минут. */
const HISTORY_SIZE = 300;
/** Через сколько после ухода из эфира забыть путь целиком (освободить память). */
const PATH_TTL_MS = 5 * 60_000;
/** Хвост progress-файла, который читаем: с запасом на 2–3 блока. */
const PROGRESS_TAIL_BYTES = 4096;
/** Ниже этого speed транскодер уже отстаёт настолько, что зритель видит рывки. */
const SPEED_UNHEALTHY_BELOW = 0.95;

/** Корень HLS-вывода. Экспортируется: тот же том читают метрики ёмкости. */
export const HLS_ROOT = '/hls';

interface PathState {
  lastBytesReceived: number;
  lastBytesSent: number;
  lastDropFrames: number | null;
  lastSampleAt: number;
  history: StatsSample[];
  lastSeenAt: number;
  /** Последний увиденный опросчиком путь — из него собирается снимок. */
  lastPath: MtxPath;
  /** Соединение-паблишер; нужно ради remoteAddr и SRT-потерь. */
  lastConn: MtxConn | null;
}

/** Сырой элемент из `/v3/paths/list` — берём только то, что используем. */
interface MtxPath {
  name: string;
  ready: boolean;
  readyTime: string | null;
  source: { type: string; id: string } | null;
  tracks2?: Array<{ codec: string; codecProps?: Record<string, any> }>;
  readers?: unknown[];
  bytesReceived?: number;
  bytesSent?: number;
  inboundFramesInError?: number;
}

interface MtxConn {
  id: string;
  path?: string;
  remoteAddr?: string;
  created?: string;
  packetsReceived?: number;
  packetsReceivedLoss?: number;
  packetsReceivedDrop?: number;
  msRTT?: number;
}

/**
 * Сбор живой статистики по каждому эфиру для дашборда стримера.
 *
 * Источников три, и они дополняют друг друга:
 *  1. `/v3/paths/list` MediaMTX — входящий битрейт (по дельте `bytesReceived`),
 *     кодеки, битые кадры, число читателей;
 *  2. `/v3/rtmpconns|srtconns/list` — кто и откуда публикует, а для SRT ещё и
 *     потери с RTT (у RTMP таких данных нет в принципе);
 *  3. progress-файл HLS-FFmpeg из `on-ready.sh` — fps, speed и **пропуск
 *     кадров на стороне сервера**; в MediaMTX этих данных нет, потому что
 *     лесенку ABR кодирует отдельный процесс.
 *
 * Всё живёт в памяти: это монитор реального времени, история нужна на минуты,
 * и переживать рестарт API ей незачем.
 */
@Injectable()
export class StatsService implements OnModuleDestroy {
  private readonly logger = new Logger(StatsService.name);
  private readonly base = process.env.MEDIAMTX_API_URL ?? 'http://localhost:9997';
  private readonly auth = {
    username: process.env.MEDIAMTX_API_USER ?? 'api',
    password: process.env.MEDIAMTX_API_PASS ?? 'mediamtxpass',
  };

  private readonly paths = new Map<string, PathState>();
  private timer: NodeJS.Timeout | null = null;
  /** Чтобы медленный опрос не накладывался сам на себя. */
  private polling = false;
  /** Удался ли последний опрос: отличает «эфира нет» от «мы не знаем». */
  private lastPollOk = false;

  constructor() {
    // setInterval, а не @Interval: сервис должен работать и в юнит-тестах без
    // ScheduleModule, а таймер тут ровно один и снимается в onModuleDestroy.
    this.timer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const paths = await this.fetchList<MtxPath>('/v3/paths/list');
      const now = Date.now();
      const live = paths.filter((p) => p.name.startsWith('live/'));
      // Списки соединений тянем ОДИН раз на тик и только если кто-то публикует:
      // на пустом сервере это лишние два запроса каждые две секунды.
      const conns = live.some((p) => p.ready && p.source) ? await this.fetchConns() : new Map();
      for (const p of live) {
        this.recordSample(p, now, conns.get(p.name) ?? null);
      }
      this.evictStale(now);
      this.lastPollOk = true;
    } catch (err: any) {
      this.lastPollOk = false;
      // MediaMTX может быть недоступен (рестарт, деплой) — это не повод шуметь
      // на каждом тике; статистика просто замрёт до следующего успешного опроса.
      this.logger.debug(`MediaMTX stats poll failed: ${err?.message ?? err}`);
    } finally {
      this.polling = false;
    }
  }

  private recordSample(p: MtxPath, now: number, conn: MtxConn | null): void {
    const prev = this.paths.get(p.name);
    const bytesReceived = p.bytesReceived ?? 0;
    const bytesSent = p.bytesSent ?? 0;

    if (!prev) {
      this.paths.set(p.name, {
        lastBytesReceived: bytesReceived,
        lastBytesSent: bytesSent,
        lastDropFrames: null,
        lastSampleAt: now,
        history: [],
        lastSeenAt: now,
        lastPath: p,
        lastConn: conn,
      });
      return; // Первая точка — только база для дельты, битрейт из неё не посчитать.
    }

    const dtSec = (now - prev.lastSampleAt) / 1000;
    prev.lastSeenAt = now;
    prev.lastPath = p;
    prev.lastConn = conn;
    if (dtSec <= 0) return;

    // Счётчики MediaMTX обнуляются при новой публикации — отрицательная дельта
    // означает именно это, а не «минусовой битрейт».
    const dIn = Math.max(0, bytesReceived - prev.lastBytesReceived);
    const dOut = Math.max(0, bytesSent - prev.lastBytesSent);

    const progress = p.ready ? this.readProgress(p.name) : null;
    let dropped: number | null = null;
    if (progress?.dropFrames != null) {
      dropped = prev.lastDropFrames == null
        ? 0
        : Math.max(0, progress.dropFrames - prev.lastDropFrames);
      prev.lastDropFrames = progress.dropFrames;
    }

    const sample: StatsSample = {
      t: now,
      inKbps: Math.round((dIn * 8) / dtSec / 1000),
      outKbps: Math.round((dOut * 8) / dtSec / 1000),
      fps: progress?.fps ?? null,
      speed: progress?.speed ?? null,
      dropped,
    };

    prev.history.push(sample);
    if (prev.history.length > HISTORY_SIZE) prev.history.shift();
    prev.lastBytesReceived = bytesReceived;
    prev.lastBytesSent = bytesSent;
    prev.lastSampleAt = now;
  }

  /**
   * Худшая скорость кодирования среди путей в эфире. null — эфира нет либо
   * FFmpeg ещё не отдал progress.
   *
   * Берётся минимум, а не среднее: если не успевает хотя бы один транскодер,
   * его зрители уже видят рывки, и усреднение с благополучными путями просто
   * спрятало бы это.
   *
   * Нужен метрикам ёмкости: без него плитка «Скорость кодирования» на экране
   * показывала бы вечный прочерк, а правило инцидента по кодированию не могло
   * бы сработать никогда.
   */
  worstEncodeSpeed(): number | null {
    let worst: number | null = null;
    for (const [name, st] of this.paths) {
      if (!st.lastPath?.ready) continue;
      const speed = this.readProgress(name)?.speed ?? null;
      if (speed === null) continue;
      if (worst === null || speed < worst) worst = speed;
    }
    return worst;
  }

  /**
   * Последний блок из progress-файла HLS-FFmpeg. Читаем хвост фиксированного
   * размера, а не файл целиком: FFmpeg пишет в него весь эфир, за 12 часов это
   * десяток мегабайт, и перечитывать их каждые 2 секунды нельзя.
   */
  private readProgress(mediamtxPath: string) {
    const file = `${HLS_ROOT}/${mediamtxPath}/progress.log`;
    let fd: number | null = null;
    try {
      fd = fs.openSync(file, 'r');
      const size = fs.fstatSync(fd).size;
      const start = Math.max(0, size - PROGRESS_TAIL_BYTES);
      const len = size - start;
      if (len <= 0) return null;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      return parseFfmpegProgress(buf.toString('utf8'));
    } catch {
      // Файла нет — либо эфир только начался, либо образ mediamtx ещё старый,
      // без `-progress`. Тогда просто нет данных транскодера, остальное живёт.
      return null;
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
  }

  private evictStale(now: number): void {
    for (const [name, st] of this.paths) {
      if (now - st.lastSeenAt > PATH_TTL_MS) this.paths.delete(name);
    }
  }

  /**
   * Снимок для дашборда — берётся ИЗ КЭША опросчика, без собственных запросов
   * к MediaMTX.
   *
   * Раньше здесь был отдельный `paths/get`, и любой его сбой (таймаут под
   * нагрузкой, рестарт медиасервера) молча превращался в `live:false` — панель
   * показывала «ОФЛАЙН» поверх идущего эфира, причём в логах не оставалось
   * ничего. Опросчик и так ходит в MediaMTX каждые 2 секунды, так что данные
   * тут свежие по определению, а признак связи вынесен отдельным полем
   * `connected` — «мы не знаем» и «эфира нет» это разные вещи.
   */
  getSnapshot(mediamtxPath: string, viewers: number): StreamStatsSnapshot {
    const st = this.paths.get(mediamtxPath);
    const history = st?.history ?? [];
    const last = history[history.length - 1];

    const path = st?.lastPath ?? null;
    const connected = this.lastPollOk && st != null;
    const live = !!path?.ready;
    const progress = live ? this.readProgress(mediamtxPath) : null;
    const conn = live ? st?.lastConn ?? null : null;

    const videoTrack = path?.tracks2?.find((t) => t.codec !== 'MPEG-4 Audio' && !/audio|opus|aac/i.test(t.codec));
    const audioTrack = path?.tracks2?.find((t) => t !== videoTrack);

    const speed = progress?.speed ?? null;
    const droppedRecently = history.slice(-15).some((s) => (s.dropped ?? 0) > 0);

    return {
      path: mediamtxPath,
      live,
      connected,
      uptimeSeconds: path?.readyTime
        ? Math.max(0, Math.round((Date.now() - new Date(path.readyTime).getTime()) / 1000))
        : null,
      source: live && path?.source
        ? {
            protocol: path.source.type,
            remoteAddr: conn?.remoteAddr ?? null,
            connectedAt: conn?.created ?? null,
          }
        : null,
      video: videoTrack
        ? {
            codec: videoTrack.codec,
            width: videoTrack.codecProps?.width ?? null,
            height: videoTrack.codecProps?.height ?? null,
            profile: videoTrack.codecProps?.profile ?? null,
            level: videoTrack.codecProps?.level ?? null,
          }
        : null,
      audio: audioTrack
        ? {
            codec: audioTrack.codec,
            sampleRate: audioTrack.codecProps?.sampleRate ?? null,
            channels: audioTrack.codecProps?.channelCount ?? null,
          }
        : null,
      ingest: {
        kbps: last?.inKbps ?? 0,
        bytesReceived: path?.bytesReceived ?? 0,
        framesInError: path?.inboundFramesInError ?? 0,
      },
      transcode: progress
        ? {
            fps: progress.fps,
            speed,
            outKbps: progress.outKbps,
            droppedFramesTotal: progress.dropFrames,
            dupFramesTotal: progress.dupFrames,
            healthy: (speed === null || speed >= SPEED_UNHEALTHY_BELOW) && !droppedRecently,
          }
        : null,
      srt: conn && path?.source?.type === 'srtConn'
        ? {
            packetsReceived: conn.packetsReceived ?? null,
            packetsLost: conn.packetsReceivedLoss ?? null,
            packetsDropped: conn.packetsReceivedDrop ?? null,
            rttMs: conn.msRTT ?? null,
          }
        : null,
      readers: path?.readers?.length ?? 0,
      viewers,
      history,
    };
  }

  /**
   * Все соединения-паблишеры разом, разложенные по путям. Три списка тянем
   * параллельно: протокол публикации заранее неизвестен, а ждать их по очереди
   * на каждом тике незачем. Упавший список просто не даёт своих записей —
   * из-за отсутствия SRT-статистики терять битрейт по RTMP не хочется.
   */
  private async fetchConns(): Promise<Map<string, MtxConn>> {
    const endpoints = ['/v3/rtmpconns/list', '/v3/srtconns/list', '/v3/rtspsessions/list'];
    const lists = await Promise.all(
      endpoints.map((e) => this.fetchList<MtxConn>(e).catch(() => [] as MtxConn[])),
    );
    const byPath = new Map<string, MtxConn>();
    for (const items of lists) {
      for (const c of items) {
        if (c.path) byPath.set(c.path, c);
      }
    }
    return byPath;
  }

  private async fetchList<T>(endpoint: string): Promise<T[]> {
    const res = await axios.get(`${this.base}${endpoint}`, { auth: this.auth, timeout: 3000 });
    return (res.data?.items ?? []) as T[];
  }
}
