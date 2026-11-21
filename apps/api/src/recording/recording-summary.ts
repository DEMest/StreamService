import { ApiProperty } from '@nestjs/swagger';

/**
 * Приведение строки Recording к виду, который уходит клиенту в списках
 * broadcast'ов (StreamService.listBroadcastsForOrg и PublicService.getOrgBroadcasts —
 * shape у них общий, поэтому и конвертер общий).
 *
 * Существует ровно из-за одного: `fileSize` в БД — BigInt (int4 не вмещает час
 * записи, см. миграцию 20260805120000_recording_filesize_bigint), а BigInt не
 * переживает `JSON.stringify` — Nest сериализует ответ и падает с
 * «TypeError: Do not know how to serialize a BigInt». Наружу отдаём number:
 * байты укладываются в безопасный диапазон double (2^53 ≈ 9 ПБ) без потери
 * точности, и фронт продолжает читать поле как `number`.
 */
export class RecordingSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Состояние записи: `processing`, `ready`, `failed`.' })
  status: string;

  @ApiProperty({ type: 'integer', nullable: true, description: 'Размер `download.mp4`, байты.' })
  fileSize: number | null;

  @ApiProperty({ type: 'integer', nullable: true, description: 'Длительность, целые секунды.' })
  duration: number | null;
}

/** Первая (slot-1) запись broadcast'а или null, если её нет. */
export function toRecordingSummary(
  rec: { id: string; status: string; fileSize: bigint | null; duration: number | null } | undefined,
): RecordingSummaryDto | null {
  if (!rec) return null;
  return {
    id: rec.id,
    status: rec.status,
    fileSize: rec.fileSize === null ? null : Number(rec.fileSize),
    duration: rec.duration,
  };
}
