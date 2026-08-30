import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { QoeService } from './qoe.service';

/** Верхние границы значений. Всё, что выше, — либо ошибка плеера, либо шутник. */
const MAX_STALLS = 100;
const MAX_MS = 60_000;

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
 * Частоту ограничивает nginx — здесь только форма данных.
 */
@Controller('v1/public/qoe')
export class QoeController {
  constructor(private qoe: QoeService) {}

  @Post()
  @HttpCode(204)
  report(@Body() body: Record<string, unknown>): void {
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
      stallMs: num(body?.stallMs, MAX_MS),
      fragLoadMs: body?.fragLoadMs != null ? num(body.fragLoadMs, MAX_MS) : null,
    });
  }
}
