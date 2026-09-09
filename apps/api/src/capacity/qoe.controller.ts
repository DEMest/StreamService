import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { QoeService } from './qoe.service';
import { SlidingWindowLimiter } from '../feedback/rate-limiter';
import { clientIp } from '../feedback/client-ip';

/** Верхние границы значений. Всё, что выше, — либо ошибка плеера, либо шутник. */
const MAX_STALLS = 100;
const MAX_MS = 60_000;

/**
 * Отдельных лимитов на этот путь в nginx нет — зоны `qoe` не существует, и
 * `/api/v1/public/qoe` живёт под общим лимитом 10 r/s на IP вместе со всем
 * остальным API. Плеер шлёт отчёт раз в 15 с (см. `qoe.service.ts`), то есть
 * один зритель — не больше 4 отчётов в минуту. 120 в минуту — это условно
 * тридцать таких зрителей за одним адресом (офис, кампус, публичный Wi-Fi)
 * одновременно, а не потолок на одного человека.
 */
export const QOE_RATE_MAX = 120;
export const QOE_RATE_WINDOW_MS = 60_000;

/**
 * `<orgSlug>/<streamSlug>` по тем же правилам, что и слаги в `StreamService`:
 * строчные буквы, цифры и дефисы. Часть после слэша может быть пустой — это
 * дефолтный стрим организации.
 *
 * Без этой проверки снаружи можно было бы насыпать в разрез «по стримам»
 * несуществующих строк. Существование стрима здесь не проверяем: поход в базу
 * на каждый отчёт зрителя обошёлся бы дороже той аккуратности, которую даёт.
 */
const STREAM_KEY_RE = /^[a-z0-9-]{1,32}\/[a-z0-9-]{0,32}$/;

/**
 * Телеметрия плеера.
 *
 * Эндпоинт публичный по своей природе — его зовёт браузер зрителя. Поэтому
 * здесь нет ни одного поля, по которому можно узнать человека: только
 * идентификатор вкладки, живущий до её закрытия, и счётчики.
 *
 * Значения обрезаются сверху: снаружи может прийти что угодно, а одно раздутое
 * число подвисаний испортило бы всю статистику, ради которой это затевалось.
 * Частоту ограничивает лимитер ниже — в nginx для этого пути отдельной зоны
 * нет, только общий лимит на всё API.
 */
@Controller('v1/public/qoe')
export class QoeController {
  private readonly limiter = new SlidingWindowLimiter(QOE_RATE_MAX, QOE_RATE_WINDOW_MS);

  constructor(private qoe: QoeService) {}

  @Post()
  @HttpCode(204)
  report(@Body() body: Record<string, unknown>, @Req() req: Request): void {
    // Превышение лимита — тихо игнорируем: это бесшумная телеметрия, зрителю
    // ответ не показывают, а раздувать 429 в логах ради этого не стоит.
    if (!this.limiter.tryHit(clientIp(req) ?? 'unknown')) return;

    const streamKey = String(body?.streamKey ?? '').slice(0, 128);
    const clientId = String(body?.clientId ?? '').slice(0, 64);
    // Без ключа стрима и клиента отчёт бесполезен: его некуда отнести.
    if (!clientId || !STREAM_KEY_RE.test(streamKey)) return;

    const num = (v: unknown, max: number): number => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
    };

    this.qoe.ingest({
      streamKey,
      clientId,
      rendition: body?.rendition ? String(body.rendition).slice(0, 16) : null,
      stalls: num(body?.stalls, MAX_STALLS),
      fragLoadMs: body?.fragLoadMs != null ? num(body.fragLoadMs, MAX_MS) : null,
    });
  }
}
