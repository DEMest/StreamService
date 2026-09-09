import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AD_EVENT_KINDS, AdEventKind, AdPlacement, AdsService } from './ads.service';
import { SlidingWindowLimiter } from '../feedback/rate-limiter';
import { clientIp } from '../feedback/client-ip';

const REASON_MAX = 64;

/**
 * Анонимная запись строки в Postgres на каждый вызов, без проверки, что adId
 * вообще существует (см. комментарий у `event` ниже) — отдельного лимита в
 * nginx для этого пути нет, только общие 10 r/s на IP. За один просмотр
 * трансляции у зрителя реалистично несколько событий (показ + закрытие
 * баннера, возможно не один баннер за сессию). 60 в минуту — это условно
 * десяток зрителей за одним адресом, отреагировавших на рекламу в одну
 * минуту, а не потолок на одного человека.
 */
export const AD_EVENT_RATE_MAX = 60;
export const AD_EVENT_RATE_WINDOW_MS = 60_000;

/**
 * Активные объявления и события их показа — публично, без авторизации: зовёт
 * анонимный браузер зрителя. Организации/суперадмины эти ручки не вызывают —
 * решение «показывать ли рекламу» принимает клиент по своей сессии
 * (см. `/v1/auth/me` в Header/WatchView), бэкенду об этом знать не нужно.
 */
@Controller('v1/public/ads')
export class PublicAdsController {
  private readonly eventLimiter = new SlidingWindowLimiter(
    AD_EVENT_RATE_MAX,
    AD_EVENT_RATE_WINDOW_MS,
  );

  constructor(private ads: AdsService) {}

  @Get()
  list() {
    return this.ads.listActive();
  }

  @Get(':id/image/:placement')
  async image(
    @Param('id') id: string,
    @Param('placement') placement: string,
    @Res() res: Response,
  ) {
    const p = parsePlacement(placement);
    const result = p ? await this.ads.serveImage(id, p) : null;
    if (!result) {
      res.status(404).end();
      return;
    }
    res.set({ 'Content-Type': result.contentType, 'Cache-Control': 'public, max-age=300' });
    res.send(result.buffer);
  }

  /**
   * Показ/закрытие баннера. Форма как у QoE-телеметрии (capacity/qoe.controller.ts):
   * никакой валидации существования adId (лишний поход в базу на каждый
   * отчёт зрителя), только форма данных — AdsService.recordEvent сам
   * проглатывает FK на уже удалённое объявление.
   */
  @Post(':id/event')
  @HttpCode(204)
  async event(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
  ): Promise<void> {
    // Превышение лимита — тихо игнорируем, как и любой другой некорректный
    // вход этой ручки ниже: зритель не должен видеть ошибку из-за баннера.
    if (!this.eventLimiter.tryHit(clientIp(req) ?? 'unknown')) return;

    const placement = parsePlacement(body?.placement);
    const kind = AD_EVENT_KINDS.includes(body?.kind as AdEventKind) ? (body!.kind as AdEventKind) : null;
    if (!placement || !kind) return;

    let reason: string | null = null;
    if (kind === 'dismiss_reason') {
      reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, REASON_MAX) : '';
      if (!reason) return;
    }

    await this.ads.recordEvent(id, placement, kind, reason);
  }
}

function parsePlacement(value: unknown): AdPlacement | null {
  return value === 'watch' || value === 'catalog' ? value : null;
}
