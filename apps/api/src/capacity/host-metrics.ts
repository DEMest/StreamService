import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import { RECORDINGS_ROOT } from '../recording/recording.service';
import { HLS_ROOT } from '../stats/stats.service';

/**
 * Железо сервера без единого стороннего экспортёра.
 *
 * Секрет в том, что `/proc` в Docker по умолчанию не изолирован: контейнер
 * видит счётчики **хоста**, а не свои собственные. Поэтому `os.cpus()` и
 * `os.totalmem()` внутри `api` возвращают ядра и память всей машины — ровно
 * то, что показывал бы node_exporter, только без ещё одного контейнера.
 *
 * Всё, что зависит от Linux (средняя нагрузка, счётчики сетевой карты),
 * аккуратно вырождается в null на машине разработчика: стенд под Windows
 * должен показывать экран, а не падать.
 */

export interface HostDisk {
  /** Точка, которую проверяли. */
  path: string;
  /** Человеческое имя: «Записи», «Живой HLS». */
  label: string;
  totalBytes: number;
  freeBytes: number;
  /** Занятая доля, 0..1. */
  usage: number;
}

export interface HostMetrics {
  cpu: {
    cores: number;
    /** Загрузка за интервал между опросами, 0..1. null — первый замер. */
    usage: number | null;
    /** Средняя нагрузка за минуту (Linux). null — Windows. */
    loadAvg1: number | null;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    usage: number;
  };
  disks: HostDisk[];
  /**
   * Сетевая карта. null — счётчиков нет (не Linux).
   *
   * `errors` и `dropped` — приросты за интервал, а не всего с загрузки: важно,
   * растут ли они прямо сейчас. Растут они раньше, чем зритель заметит рывок,
   * поэтому это самый ранний признак насыщения канала.
   */
  net: { rxMbps: number; txMbps: number; errors: number; dropped: number } | null;
  /** Сколько машина работает без перезагрузки, секунд. */
  uptimeSeconds: number;
}

/**
 * Что проверяем на заполнение. Пути берутся из существующих констант, а не из
 * собственных переменных окружения: заводить второй способ задать те же
 * каталоги — верный способ однажды измерить не тот диск.
 * Отсутствующие пути молча пропускаются.
 */
const WATCHED_PATHS: Array<{ path: string; label: string }> = [
  { path: HLS_ROOT, label: 'Живой HLS' },
  { path: RECORDINGS_ROOT, label: 'Записи' },
];

interface CpuTotals {
  idle: number;
  total: number;
}

function cpuTotals(): CpuTotals {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  return { idle, total };
}

interface NetTotals {
  rx: number;
  tx: number;
  errors: number;
  dropped: number;
}

/**
 * Счётчики интерфейсов из `/proc/net/dev`.
 *
 * `lo` исключён намеренно: обмен между контейнерами на одной машине идёт через
 * петлю и к нагрузке на канал отношения не имеет.
 *
 * Порядок колонок фиксирован ядром: приём — bytes packets errs drop … (индексы
 * 0, 2, 3), передача — те же поля со сдвигом на восемь (8, 10, 11). Ошибки и
 * потери приёма с передачей складываются: разбираться, в какую сторону карта
 * не справляется, здесь незачем — важен сам факт.
 *
 * Экспортируется ради тестов: `/proc` есть не на всякой машине разработчика.
 */
export function parseNetDev(raw: string): NetTotals {
  let rx = 0;
  let tx = 0;
  let errors = 0;
  let dropped = 0;

  for (const line of raw.split('\n').slice(2)) {
    const [name, rest] = line.split(':');
    if (!rest) continue;
    if (name.trim() === 'lo') continue;
    const c = rest.trim().split(/\s+/).map(Number);
    rx += c[0] || 0;
    tx += c[8] || 0;
    errors += (c[2] || 0) + (c[10] || 0);
    dropped += (c[3] || 0) + (c[11] || 0);
  }
  return { rx, tx, errors, dropped };
}

function netTotals(): NetTotals | null {
  try {
    return parseNetDev(fs.readFileSync('/proc/net/dev', 'utf8'));
  } catch {
    return null;
  }
}

function diskUsage(): HostDisk[] {
  const out: HostDisk[] = [];
  for (const { path, label } of WATCHED_PATHS) {
    try {
      const st = fs.statfsSync(path);
      const total = st.blocks * st.bsize;
      // bavail, а не bfree: часть блоков зарезервирована под root и обычному
      // процессу недоступна — считать их свободными значит себя обманывать.
      const free = st.bavail * st.bsize;
      if (total <= 0) continue;
      out.push({ path, label, totalBytes: total, freeBytes: free, usage: 1 - free / total });
    } catch {
      // Пути нет (стенд разработчика) — просто не показываем эту строку.
    }
  }

  // На машине разработчика томов прода не существует, и блок остался бы
  // пустым. Показываем раздел, на котором лежит сам процесс: смысл тот же —
  // «сколько места осталось», — а вёрстка проверяется на живых числах.
  if (out.length === 0) {
    try {
      const st = fs.statfsSync(process.cwd());
      const total = st.blocks * st.bsize;
      const free = st.bavail * st.bsize;
      if (total > 0) {
        out.push({
          path: process.cwd(),
          label: 'Диск',
          totalBytes: total,
          freeBytes: free,
          usage: 1 - free / total,
        });
      }
    } catch {
      // Совсем без данных о диске — блок просто не покажет эту плитку.
    }
  }

  return out;
}

/**
 * Снимает железо с дельтой между вызовами.
 *
 * Загрузка процессора и трафик — величины за интервал, поэтому объект хранит
 * предыдущий замер. Первый вызов честно отдаёт null вместо нуля: «мы ещё не
 * знаем» и «нагрузки нет» на экране должны выглядеть по-разному.
 */
@Injectable()
export class HostMetricsReader {
  private prevCpu: CpuTotals | null = null;
  private prevNet: (NetTotals & { at: number }) | null = null;

  read(): HostMetrics {
    const now = Date.now();

    const cpu = cpuTotals();
    let usage: number | null = null;
    if (this.prevCpu) {
      const dTotal = cpu.total - this.prevCpu.total;
      const dIdle = cpu.idle - this.prevCpu.idle;
      if (dTotal > 0) usage = Math.min(1, Math.max(0, 1 - dIdle / dTotal));
    }
    this.prevCpu = cpu;

    const net = netTotals();
    let netRate: HostMetrics['net'] = null;
    if (net) {
      if (this.prevNet) {
        const dt = (now - this.prevNet.at) / 1000;
        if (dt > 0) {
          // Счётчики ядра обнуляются при подъёме интерфейса — отрицательная
          // дельта означает именно это, а не минусовой трафик.
          const delta = (a: number, b: number) => Math.max(0, a - b);
          netRate = {
            rxMbps: +((delta(net.rx, this.prevNet.rx) * 8) / dt / 1e6).toFixed(1),
            txMbps: +((delta(net.tx, this.prevNet.tx) * 8) / dt / 1e6).toFixed(1),
            errors: delta(net.errors, this.prevNet.errors),
            dropped: delta(net.dropped, this.prevNet.dropped),
          };
        }
      }
      this.prevNet = { ...net, at: now };
    }

    const totalMem = os.totalmem();
    const usedMem = totalMem - os.freemem();

    return {
      cpu: {
        cores: os.cpus().length,
        usage: usage != null ? +usage.toFixed(3) : null,
        // На Windows loadavg всегда нули — это не нагрузка, это отсутствие данных.
        loadAvg1: os.platform() === 'win32' ? null : +os.loadavg()[0].toFixed(2),
      },
      memory: {
        totalBytes: totalMem,
        usedBytes: usedMem,
        usage: totalMem > 0 ? +(usedMem / totalMem).toFixed(3) : 0,
      },
      disks: diskUsage(),
      net: netRate,
      uptimeSeconds: Math.round(os.uptime()),
    };
  }
}
