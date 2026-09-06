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
   * `width`/`height` по умолчанию — 1280×720 (орга/стрим/запись).
   *
   * `fit: 'cover'` (по умолчанию) обрезает лишнее — годится для фото, где
   * кроп выбирает пользователь. Готовые рекламные баннеры — не фото: это
   * уже собранный дизайнером креатив под конкретный IAB-размер, и `cover`
   * обрезал бы часть текста/логотипа на нём. Для рекламы (см. AdsService)
   * передаётся `fit: 'contain'` — картинка вписывается целиком, лишнее поле
   * (если баннер прислали чуть не того соотношения) закрашивается фоном.
   */
  async processToJpeg(
    buffer: Buffer,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    fit: 'cover' | 'contain' = 'cover',
  ): Promise<Buffer> {
    try {
      return await sharp(buffer)
        .resize(width, height, {
          fit,
          ...(fit === 'contain' ? { background: { r: 12, g: 12, b: 14, alpha: 1 } } : {}),
        })
        .jpeg({ quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Invalid image file');
    }
  }

  async upload(
    key: string,
    buffer: Buffer,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    fit: 'cover' | 'contain' = 'cover',
  ): Promise<void> {
    const jpeg = await this.processToJpeg(buffer, width, height, fit);
    await this.s3.putObject(key, jpeg, 'image/jpeg');
  }

  /**
   * Как upload(), но сохраняет анимацию (GIF → анимированный WebP). JPEG
   * анимацию не умеет в принципе, поэтому формат вывода тут всегда webp.
   * `{ animated: true }` в конструкторе sharp — иначе он возьмёт только
   * первый кадр, как и обычный `upload()`.
   *
   * Кроп на входе не проходит (см. AdsService/AdImageSlot): canvas-кроппер
   * умеет работать только с одним кадром, поэтому анимированный баннер
   * сервер только безопасно вписывает в размер (fit: contain, как и статику
   * с чужими пропорциями) — обрезать анимацию по кадрам мы не беремся.
   */
  async processToAnimatedWebp(buffer: Buffer, width: number, height: number): Promise<Buffer> {
    try {
      return await sharp(buffer, { animated: true })
        .resize(width, height, { fit: 'contain', background: { r: 12, g: 12, b: 14, alpha: 1 } })
        .webp({ quality: 80 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Invalid image file');
    }
  }

  async uploadAnimated(key: string, buffer: Buffer, width: number, height: number): Promise<void> {
    const webp = await this.processToAnimatedWebp(buffer, width, height);
    await this.s3.putObject(key, webp, 'image/webp');
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
