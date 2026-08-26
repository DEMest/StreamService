import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

/**
 * Служебные письма администратору платформы.
 *
 * Почтовая отправка на сервере уже была — `infra/deploy/deploy.sh` шлёт письма
 * о выкатке через `/home/rootuser/ops/notify.py`. Переиспользовать сам скрипт
 * нельзя: api живёт в контейнере из node:20-alpine, где нет ни python'а, ни
 * хостового `/home/rootuser/ops`. Переиспользуются реквизиты: имена переменных
 * здесь ровно те же, что в `ops/notify.env`, поэтому на сервере их достаточно
 * скопировать в корневой `.env` проекта.
 *
 * Не настроено — не беда: send() пишет предупреждение один раз и возвращает
 * false. Та же логика, что у notify() в deploy.sh: неотправленное письмо не
 * повод ронять то, ради чего его слали.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private missingConfigLogged = false;

  /**
   * Таймауты обязательны: без них зависший SMTP держит сокет до победного, а
   * отправка идёт фоном к запросу пользователя, который уже получил ответ.
   */
  private static readonly TIMEOUT_MS = 10_000;

  isConfigured(): boolean {
    return Boolean(
      process.env.SMTP_HOST?.trim() &&
        process.env.SMTP_USER?.trim() &&
        process.env.SMTP_PASS &&
        this.recipient(),
    );
  }

  /**
   * Никогда не бросает и никогда не отклоняется — вызывающий код имеет право
   * написать `void mail.send(...)` и не ловить ничего.
   *
   * @returns true, если письмо ушло.
   */
  async send(subject: string, text: string): Promise<boolean> {
    if (!this.isConfigured()) {
      if (!this.missingConfigLogged) {
        this.missingConfigLogged = true;
        this.logger.warn(
          'SMTP не настроен (нужны SMTP_HOST, SMTP_USER, SMTP_PASS, MAIL_TO) — письма не отправляются',
        );
      }
      return false;
    }

    try {
      await this.transport().sendMail({
        from: process.env.MAIL_FROM?.trim() || process.env.SMTP_USER!.trim(),
        to: this.recipient(),
        subject,
        text,
      });
      return true;
    } catch (e) {
      this.logger.error(`Письмо «${subject}» не отправлено: ${(e as Error).message}`);
      return false;
    }
  }

  private recipient(): string {
    return process.env.MAIL_TO?.trim() ?? '';
  }

  private transport(): Transporter {
    if (this.transporter) return this.transporter;

    const port = Number(process.env.SMTP_PORT ?? 587) || 587;
    this.transporter = createTransport({
      host: process.env.SMTP_HOST!.trim(),
      port,
      // 465 — TLS с первого байта, 587 — STARTTLS поверх открытого соединения.
      // Явный SMTP_SECURE нужен только для нестандартных портов.
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: {
        user: process.env.SMTP_USER!.trim(),
        pass: process.env.SMTP_PASS!,
      },
      connectionTimeout: MailService.TIMEOUT_MS,
      greetingTimeout: MailService.TIMEOUT_MS,
      socketTimeout: MailService.TIMEOUT_MS,
    });
    return this.transporter;
  }
}
