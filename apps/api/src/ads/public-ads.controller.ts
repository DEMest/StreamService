import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AD_EVENT_KINDS, AdEventKind, AdPlacement, AdsService } from './ads.service';

const REASON_MAX = 64;

/**
 * Активные объявления и события их показа — публично, без авторизации: зовёт
 * анонимный браузер зрителя. Организации/суперадмины эти ручки не вызывают —
 * решение «показывать ли рекламу» принимает клиент по своей сессии
 * (см. `/v1/auth/me` в Header/WatchView), бэкенду об этом знать не нужно.
 */
@Controller('v1/public/ads')
export class PublicAdsController {
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
    const buffer = p ? await this.ads.serveImage(id, p) : null;
    if (!buffer) {
      res.status(404).end();
      return;
    }
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=300' });
    res.send(buffer);
  }

  /**
   * Показ/закрытие баннера. Форма как у QoE-телеметрии (capacity/qoe.controller.ts):
   * никакой валидации существования adId (лишний поход в базу на каждый
   * отчёт зрителя), только форма данных — AdsService.recordEvent сам
   * проглатывает FK на уже удалённое объявление.
   */
  @Post(':id/event')
  @HttpCode(204)
  async event(@Param('id') id: string, @Body() body: Record<string, unknown>): Promise<void> {
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
