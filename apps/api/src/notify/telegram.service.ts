import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/**
 * Уведомления в телеграм.
 *
 * Устроен по образцу {@link MailService} и с тем же обещанием: никогда не
 * бросает и никогда не отклоняется. Вызывающий код имеет право написать
 * `void telegram.send(...)` и ничего не ловить — тревога о перегрузке канала
 * не должна сама становиться причиной сбоя.
 *
 * Не настроено — не беда: предупреждение пишется один раз, дальше молчим.
 * Письмо всё равно уходит, телеграм тут дополнение, а не замена.
 */
@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private missingConfigLogged = false;

  /** Без таймаута зависший запрос держал бы сокет до победного. */
  private static readonly TIMEOUT_MS = 10_000;

  isConfigured(): boolean {
    return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
  }

  /** @returns true, если сообщение ушло. */
  async send(text: string): Promise<boolean> {
    if (!this.isConfigured()) {
      if (!this.missingConfigLogged) {
        this.missingConfigLogged = true;
        this.logger.warn(
          'Телеграм не настроен (нужны TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID) — уведомления уходят только письмом',
        );
      }
      return false;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN!.trim();
    try {
      await axios.post(
        `https://api.telegram.org/bot${token}/sendMessage`,
        {
          chat_id: process.env.TELEGRAM_CHAT_ID!.trim(),
          text,
          disable_web_page_preview: true,
        },
        { timeout: TelegramService.TIMEOUT_MS },
      );
      return true;
    } catch (err: unknown) {
      // Токен в текст ошибки не попадает: axios пишет URL целиком, а в нём
      // лежит секрет бота.
      this.logger.warn(`Не удалось отправить сообщение в телеграм: ${describe(err)}`);
      return false;
    }
  }
}

/** Короткое описание ошибки без URL, в котором содержится токен бота. */
function describe(err: unknown): string {
  if (axios.isAxiosError(err)) {
    return err.response ? `HTTP ${err.response.status}` : (err.code ?? 'сеть недоступна');
  }
  return (err as Error)?.message ?? String(err);
}
