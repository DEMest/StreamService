import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import * as sharp from 'sharp';
import { S3Service } from './s3.service';

/** Дефолт для орги/стрима/записи — единственных превью, которые всегда 16:9. */
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

/**
 * Единый пайплайн статичных картинок-превью (орга / стрим / запись / реклама):
 * нормализация в JPEG нужного размера (cover) → S3; отдача — прокси Buffer'ом
 * через API (объекты маленькие, presigned-редирект не нужен, кешируется
 * браузером). Ключи задают вызывающие:
 *   images/org/<orgId>.jpg | images/stream/<streamId>.jpg |
 *   archive/<basePath>/<broadcastId>/preview.jpg | images/ad/<adId>-<placement>.jpg
 */
@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  constructor(private s3: S3Service) {}

  /**
   * sharp не смог декодировать → 400: загрузили не картинку.
   *
   * Кроп нужного соотношения выбирает пользователь в браузере ещё до
   * отправки (см. ImageCropModal), так что `cover` здесь обычно уже ничего
   * не режет — он остаётся страховкой для картинок, пришедших мимо UI (curl,
   * старые клиенты), и для несовпадения на пиксель после сжатия в JPEG.
   *
   * `width`/`height` по умолчанию — 1280×720 (орга/стрим/запись); реклама
   * передаёт свой размер под конкретный плейсмент (см. AdsService) — он
   * обязан совпадать с тем, что задаёт клиенту ImageCropModal, иначе кроп,
   * который админ выбрал глазами, будет ещё раз обрезан здесь вслепую.
   */
  async processToJpeg(buffer: Buffer, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .resize(width, height, { fit: 'cover' })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Invalid image file');
    }
  }

  async upload(key: string, buffer: Buffer, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT): Promise<void> {
    const jpeg = await this.processToJpeg(buffer, width, height);
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
