import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as fs from 'fs';
import * as path from 'path';

interface UploadMeta {
  contentType: string;
  cacheControl: string;
}

function metaFor(relPath: string): UploadMeta {
  if (relPath.endsWith('.m3u8')) {
    return { contentType: 'application/vnd.apple.mpegurl', cacheControl: 'no-cache' };
  }
  if (relPath.endsWith('.mp4')) {
    return { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' };
  }
  if (relPath.endsWith('.jpg')) {
    // Превью записи (preview.jpg в broadcastDir) — картинка меняется при
    // ручной замене, поэтому короткий max-age, а не immutable.
    return { contentType: 'image/jpeg', cacheControl: 'public, max-age=300' };
  }
  return { contentType: 'video/mp2t', cacheControl: 'public, max-age=31536000, immutable' };
}

/**
 * Тонкая DI-обёртка над S3-совместимым объектным хранилищем (AWS SDK v3).
 * Работает с любым провайдером, реализующим S3 API — endpoint/ключи через env.
 * Используется ТОЛЬКО для готового архива трансляций; live-эфир хранится локально.
 *
 * Два клиента:
 *  - `client` (S3_ENDPOINT) — серверные операции (upload/list/delete/get) по
 *    внутренней сети (в docker-стеке это `http://minio:9000`).
 *  - `presignClient` (S3_PUBLIC_ENDPOINT, по умолчанию = S3_ENDPOINT) — ТОЛЬКО
 *    для генерации presigned-ссылок: подпись SigV4 включает Host, поэтому URL
 *    должен строиться против адреса, до которого дотянется БРАУЗЕР (локально —
 *    `http://localhost:9000`, в проде — публичный endpoint провайдера).
 */
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly presignClient: S3Client;
  private readonly bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? '';
    const common = {
      region: process.env.S3_REGION || 'us-east-1',
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
      },
    };
    this.client = new S3Client({
      ...common,
      endpoint: process.env.S3_ENDPOINT || undefined,
    });
    this.presignClient = new S3Client({
      ...common,
      endpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || undefined,
    });
  }

  /**
   * Заливает перечисленные файлы localDir под keyPrefix (имя файла = хвост
   * ключа). Потоковая multipart-заливка (`@aws-sdk/lib-storage`) — склейка
   * записи на высоком битрейте превышает и лимит Buffer (2 GiB), и потолок
   * одиночного PutObject (5 GB); readFileSync здесь нельзя.
   */
  async uploadFiles(localDir: string, fileNames: string[], keyPrefix: string): Promise<void> {
    for (const name of fileNames) {
      const meta = metaFor(name);
      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.bucket,
          Key: `${keyPrefix}/${name}`,
          Body: fs.createReadStream(path.join(localDir, name)),
          ContentType: meta.contentType,
          CacheControl: meta.cacheControl,
        },
      });
      await upload.done();
    }
    this.logger.log(`Uploaded ${fileNames.length} file(s) to s3://${this.bucket}/${keyPrefix}`);
  }

  /** Размер объекта в байтах. */
  async getObjectSize(key: string): Promise<number> {
    const res = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    return res.ContentLength ?? 0;
  }

  /** Байты [offset, offset+length) объекта — range-GET, без скачивания целиком. */
  async getObjectRange(key: string, offset: number, length: number): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Range: `bytes=${offset}-${offset + length - 1}`,
    }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  /**
   * Тело объекта как строка (для проксирования HLS-плейлистов через API —
   * крошечный текст; сегменты, наоборот, отдаются presigned-редиректом).
   */
  async getObjectText(key: string): Promise<string> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    return await res.Body!.transformToString();
  }

  /**
   * Одиночный маленький объект (картинки-превью, плейлисты). Для больших
   * файлов — uploadFiles (потоковый multipart).
   */
  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=300',
    }));
  }

  /** Тело объекта как Buffer — для проксирования картинок через API. */
  async getObjectBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  /** Удаление одного объекта. Отсутствующий ключ — не ошибка (S3-семантика). */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    }));
  }

  /**
   * Presigned GET-ссылка на объект (по умолчанию 5 минут жизни), построенная
   * против ПУБЛИЧНОГО endpoint'а (см. presignClient в шапке класса).
   * `responseContentDisposition` — переопределяет Content-Disposition в ответе
   * S3 (используется для скачивания с человекочитаемым именем файла).
   */
  async getPresignedUrl(
    key: string,
    opts?: { expiresInSeconds?: number; responseContentDisposition?: string },
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: opts?.responseContentDisposition,
    });
    return getSignedUrl(this.presignClient, command, { expiresIn: opts?.expiresInSeconds ?? 300 });
  }

  /** Листинг + пакетное удаление всех объектов под префиксом (аналог rm -rf для S3). */
  async deleteByPrefix(keyPrefix: string): Promise<void> {
    let continuationToken: string | undefined;
    const allKeys: string[] = [];
    do {
      const list = await this.client.send(new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: keyPrefix,
        ContinuationToken: continuationToken,
      }));
      for (const obj of list.Contents ?? []) {
        if (obj.Key) allKeys.push(obj.Key);
      }
      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);

    if (allKeys.length === 0) return;

    for (let i = 0; i < allKeys.length; i += 1000) {
      const chunk = allKeys.slice(i, i + 1000);
      await this.client.send(new DeleteObjectsCommand({
        Bucket: this.bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })) },
      }));
    }
    this.logger.log(`Deleted ${allKeys.length} object(s) under s3://${this.bucket}/${keyPrefix}`);
  }
}
