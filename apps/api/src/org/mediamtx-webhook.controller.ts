import {
  Body,
  Controller,
  Headers,
  Logger,
  OnModuleInit,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { StreamService } from '../stream/stream.service';
import { SlidingWindowLimiter } from '../feedback/rate-limiter';
import { clientIp } from '../feedback/client-ip';

/**
 * `handleAuth` дёргает MediaMTX на каждый RTMP-publish, и проверка бьёт в БД
 * (`StreamService.verifyIngestKey`). `ingestKey` — 144 бита случайности
 * (`randomBytes(18)`), так что перебором его не подобрать ни при каком
 * реалистичном лимите; лимит здесь — страховка от долбёжки по эндпоинту с
 * одного адреса (лишняя нагрузка на БД и лог), а не защита от подбора ключа.
 *
 * Multistream-стрим — это до 4 независимых фидов, которые обычно уходят с
 * одного адреса (один роутер на площадке), и при плохой сети каждый может
 * переподключаться по несколько раз в минуту. 60 попыток в минуту (1/сек в
 * среднем) — с большим запасом на такой реконнект-шторм: обычный обрыв связи
 * это не заденет, а вот аномальный поток с одного IP — остановит.
 */
export const MEDIAMTX_AUTH_RATE_MAX = 60;
export const MEDIAMTX_AUTH_RATE_WINDOW_MS = 60_000;

@Controller('v1/internal/mediamtx')
export class MediamtxWebhookController implements OnModuleInit {
  private readonly logger = new Logger(MediamtxWebhookController.name);
  private readonly authLimiter = new SlidingWindowLimiter(
    MEDIAMTX_AUTH_RATE_MAX,
    MEDIAMTX_AUTH_RATE_WINDOW_MS,
  );

  constructor(private stream: StreamService) {}

  onModuleInit(): void {
    // Не падение: без секрета вебхук просто станет fail-closed (см. ниже) и
    // будет отклонять любые уведомления MediaMTX, а не открытым текстом
    // принимать чужие. Падение API здесь хуже — оно рвёт раздачу HLS всем.
    if (!process.env.MEDIAMTX_WEBHOOK_SECRET) {
      this.logger.error(
        'MEDIAMTX_WEBHOOK_SECRET не задан — POST /v1/internal/mediamtx/webhook будет отклонять все запросы',
      );
    }
  }

  @Post('auth')
  async handleAuth(
    @Body() body: {
      user?: string;
      password?: string;
      ip?: string;
      action?: string;
      path?: string;
      protocol?: string;
      query?: string;
    },
  ) {
    if (body.action !== 'publish') return { ok: true };

    if (body.protocol === 'srt') return { ok: true };

    const segments = body.path?.match(/^live\/(.+)$/)?.[1]?.split('/').filter((s) => s.length > 0);
    if (!segments || segments.length === 0) {
      this.logger.warn(`Auth rejected: invalid path "${body.path}" from ${body.ip}`);
      throw new UnauthorizedException('Invalid path');
    }
    const orgSlug = segments[0];
    const streamSlug = segments.slice(1).join('/');

    const params = new URLSearchParams(body.query ?? '');
    // vMix строит адрес как URL + "/" + <Stream Name or Key>: при пустом поле ключа
    // к query приклеивается хвостовой "/" — не считаем его частью ключа.
    const key = (params.get('key') || body.password)?.replace(/\/+$/, '');
    const pathLabel = `"${orgSlug}/${streamSlug}"`;
    if (!key) {
      this.logger.warn(`RTMP auth rejected for ${pathLabel}: no key (${body.ip})`);
      throw new UnauthorizedException('No key provided');
    }

    // Тот же способ определения адреса, что и у публичных HTTP-ручек
    // (`feedback/client-ip.ts`), просто без заголовков прокси: сюда MediaMTX
    // кладёт реальный адрес паблишера прямо в тело запроса.
    const ip = clientIp({ headers: {}, ip: body.ip }) ?? 'unknown';
    if (!this.authLimiter.tryHit(ip)) {
      this.logger.warn(`RTMP auth rejected for ${pathLabel}: rate limit exceeded (${body.ip})`);
      throw new UnauthorizedException('Too many attempts');
    }

    const valid = await this.stream.verifyIngestKey(orgSlug, streamSlug, key);
    if (!valid) {
      this.logger.warn(`RTMP auth rejected for ${pathLabel}: invalid key (${body.ip})`);
      throw new UnauthorizedException('Invalid key');
    }

    this.logger.log(`RTMP auth accepted for ${pathLabel} (${body.ip})`);
    return { ok: true };
  }

  @Post('webhook')
  async handleWebhook(
    @Headers('authorization') auth: string,
    @Body() body: { action: string; path: string },
  ) {
    const secret = process.env.MEDIAMTX_WEBHOOK_SECRET;
    // Fail-closed: пустой секрет означает «неправильно настроено», а не
    // «проверка не нужна». На проде секрет всегда задан и реально требуется —
    // внешний POST без него получает 401 уже сейчас.
    if (!secret || auth !== `Bearer ${secret}`) {
      throw new UnauthorizedException();
    }

    if (body.action === 'publish' || body.action === 'unpublish') {
      await this.stream.handleWebhook(body.path, body.action);
    }

    return { ok: true };
  }
}
