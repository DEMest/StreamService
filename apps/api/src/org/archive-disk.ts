import * as fs from 'fs';
import { RECORDINGS_ROOT } from '../recording/recording.service';

/**
 * Свободное место тома, на котором лежит архив записей.
 *
 * Одно правило на двоих потребителей: карточку «Хранилище» на дашборде орги
 * (`OrgService.getStorage`) и тревогу о заполнении диска на экране ёмкости
 * (`CapacityAlertsService`). Разъехавшись, они показывали бы орге одно, а
 * суперадмину слали бы тревогу о другом.
 */

/**
 * `disk` — null в двух РАЗНЫХ случаях, поэтому рядом идёт статус: без него
 * нельзя отличить «архив во внешнем S3, места мы не меряем» от «мерить не
 * удалось». Фронт во втором случае показывал орге заведомую неправду, а
 * тревога молча не видела бы диска.
 */
export type DiskStatus = 'ok' | 'external' | 'unavailable';

export interface ArchiveDisk {
  disk: { totalBytes: number; freeBytes: number } | null;
  diskStatus: DiskStatus;
  /** Текст ошибки statfs при `unavailable` — логирует вызывающий, как ему удобно. */
  error?: string;
}

/**
 * Архив лежит в MinIO из этого же docker-стека (том `minio_data` на том же
 * LVM-разделе, что и `recordings_data`), поэтому statfs по `/recordings`
 * показывает ровно тот запас, в который упрётся заливка записи. Если
 * `S3_ENDPOINT` указывает на внешнего провайдера — связи больше нет.
 *
 * Разбираем именно hostname, а не строку целиком: имя сервиса в compose может
 * быть и `minio`, и `streamservice-minio` — regex по всему URL на втором
 * варианте молча давал false и метрика исчезала без единого лога.
 */
export function isLocalS3(endpoint = process.env.S3_ENDPOINT): boolean {
  if (!endpoint) return false;
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true;
  // Внешний провайдер всегда приходит FQDN'ом с точками, docker-имя сервиса —
  // всегда одна метка. Так `minio.s3-provider.com` не будет принят за свой.
  if (hostname.includes('.')) return false;
  // `minio`, `streamservice-minio`, `minio-1`, `minio2`.
  return /(^|-)minio[-\d]*$/.test(hostname);
}

/**
 * `bavail` (а не `bfree`) — блоки, доступные непривилегированному процессу:
 * ext4 резервирует ~5% под root, и записать их сервис всё равно не сможет.
 * Из `totalBytes` этот же root-резерв вычитается, иначе процент занятого
 * расходится с тем, что показывает `df` (38% против 36%).
 *
 * `statfs` подменяется только в тестах.
 */
export function readArchiveDisk(statfs: (path: string) => fs.StatsFs = fs.statfsSync): ArchiveDisk {
  if (!isLocalS3()) return { disk: null, diskStatus: 'external' };
  try {
    const st = statfs(RECORDINGS_ROOT);
    const rootReserved = st.bfree - st.bavail;
    return {
      disk: {
        totalBytes: (st.blocks - rootReserved) * st.bsize,
        freeBytes: st.bavail * st.bsize,
      },
      diskStatus: 'ok',
    };
  } catch (err: any) {
    // На dev-машине без /recordings (api запущен вне docker) statfs кинет
    // ENOENT — это штатная ситуация, а не повод ронять вызывающего.
    return { disk: null, diskStatus: 'unavailable', error: `statfs(${RECORDINGS_ROOT}) failed: ${err?.message ?? err}` };
  }
}
