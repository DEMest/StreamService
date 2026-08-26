import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as sharp from 'sharp';
import { S3Service } from './s3.service';

/**
 * Единый пайплайн статичных картинок-превью (орга / стрим / запись):
 * нормализация в JPEG 1280×720 (cover) → S3; отдача — прокси Buffer'ом через
 * API (объекты маленькие, presigned-редирект не нужен, кешируется браузером).
 * Ключи задают вызывающие:
 *   images/org/<orgId>.jpg | images/stream/<streamId>.jpg |
 *   archive/<basePath>/<broadcastId>/preview.jpg
 */
@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  constructor(private s3: S3Service) {}

  /**
   * sharp не смог декодировать → 400: загрузили не картинку.
   *
   * Кроп 16:9 выбирает пользователь в браузере ещё до отправки, так что
   * `cover` здесь обычно уже ничего не режет — он остаётся страховкой для
   * картинок, пришедших мимо UI (curl, старые клиенты).
   */
  async processToJpeg(buffer: Buffer): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .resize(1280, 720, { fit: 'cover' })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Invalid image file');
    }
  }

  async upload(key: string, buffer: Buffer): Promise<void> {
    const jpeg = await this.processToJpeg(buffer);
    await this.s3.putObject(key, jpeg, 'image/jpeg');
  }

  /** null — объекта нет/S3 недоступен; контроллеры превращают это в 404. */
  async serve(key: string): Promise<Buffer | null> {
    try {
      return await this.s3.getObjectBuffer(key);
    } catch {
      return null;
    }
  }

  /** Ошибки глотаются: удаление картинки не должно валить основную операцию. */
  async delete(key: string): Promise<void> {
    try {
      await this.s3.deleteObject(key);
    } catch (err: any) {
      this.logger.warn(`Failed to delete image ${key}: ${err?.message ?? err}`);
    }
  }
}
