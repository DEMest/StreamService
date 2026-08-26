import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../notify/mail.service';
import { SlidingWindowLimiter } from './rate-limiter';

export interface CreateFeedbackDto {
  topic: string;
  message: string;
  contact?: string;
  pageUrl?: string;
  orgSlug?: string;
  streamSlug?: string;
  /**
   * Honeypot. Поле спрятано от глаз и от скринридеров, живой человек его не
   * заполняет; заполнено — перед нами бот.
   */
  website?: string;
}

export interface FeedbackMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** Границы полей. Проверяются на сервере, а не только в браузере. */
export const FIELD_LIMITS = {
  topic: { min: 3, max: 120 },
  message: { min: 5, max: 4000 },
  contact: { max: 200 },
  pageUrl: { max: 500 },
  slug: { max: 64 },
  userAgent: { max: 400 },
} as const;

export const RATE_WINDOW_MS = 60 * 60 * 1000;
/** Обращений с одного адреса в час. */
export const RATE_PER_IP = 5;
/**
 * Общий потолок за час по всем адресам сразу. Нужен именно как страховка: за
 * двумя прокси адрес иногда не определяется, и тогда персонального лимита нет.
 * Пять десятков обращений в час — заведомо больше любого реального всплеска
 * даже при аварии на многотысячной трансляции.
 */
export const RATE_GLOBAL = 60;

const GLOBAL_KEY = '*';

@Injectable()
export class FeedbackService {
  private readonly perIp = new SlidingWindowLimiter(RATE_PER_IP, RATE_WINDOW_MS);
  private readonly global = new SlidingWindowLimiter(RATE_GLOBAL, RATE_WINDOW_MS, 1);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async create(dto: CreateFeedbackDto, meta: FeedbackMeta = {}) {
    // Боту отвечаем обычным успехом. Честный 400 сообщил бы ему, какое поле
    // лишнее, и форма запроса подобралась бы с третьей попытки.
    if (dto?.website?.trim()) return { ok: true as const, id: null };

    // Валидация раньше лимитов: человек, промахнувшийся с длиной, не должен
    // сжечь себе часовую квоту на опечатках.
    const topic = requiredText(dto?.topic, 'Тема', FIELD_LIMITS.topic);
    const message = requiredText(dto?.message, 'Комментарий', FIELD_LIMITS.message);
    const contact = optionalText(dto?.contact, FIELD_LIMITS.contact.max);

    if (!this.global.tryHit(GLOBAL_KEY)) throw tooManyRequests();
    // Адрес не определился — общего потолка достаточно. Схлопывать всех в один
    // счётчик нельзя: пятый зритель с проблемой получил бы отказ.
    if (meta.ip && !this.perIp.tryHit(meta.ip)) throw tooManyRequests();

    const created = await this.prisma.feedback.create({
      data: {
        topic,
        message,
        contact,
        pageUrl: optionalText(dto?.pageUrl, FIELD_LIMITS.pageUrl.max),
        orgSlug: optionalText(dto?.orgSlug, FIELD_LIMITS.slug.max),
        streamSlug: optionalText(dto?.streamSlug, FIELD_LIMITS.slug.max),
        userAgent: optionalText(meta.userAgent ?? undefined, FIELD_LIMITS.userAgent.max),
      },
      select: { id: true, topic: true, message: true, contact: true, pageUrl: true, orgSlug: true, streamSlug: true, createdAt: true },
    });

    // Письмо — фоном. Ответ зрителю не должен зависеть ни от доступности
    // SMTP, ни от его скорости. .catch() формально лишний (MailService не
    // отклоняется), но unhandled rejection здесь уронил бы весь процесс api.
    void this.mail
      .send(`[liga-live] Обратная связь: ${created.topic}`, letter(created))
      .catch(() => undefined);

    return { ok: true as const, id: created.id };
  }

  list(status?: string) {
    return this.prisma.feedback.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateStatus(id: string, status: string) {
    try {
      return await this.prisma.feedback.update({ where: { id }, data: { status } });
    } catch (e: any) {
      if (e.code === 'P2025') throw new NotFoundException(`Feedback '${id}' not found`);
      throw e;
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.feedback.delete({ where: { id } });
    } catch (e: any) {
      if (e.code === 'P2025') throw new NotFoundException(`Feedback '${id}' not found`);
      throw e;
    }
    return { ok: true };
  }
}

interface LetterFields {
  topic: string;
  message: string;
  contact: string | null;
  pageUrl: string | null;
  orgSlug: string | null;
  streamSlug: string | null;
  createdAt: Date;
}

/**
 * Текст письма. Читается на телефоне в уведомлении, поэтому тема и текст
 * обращения идут первыми, а технический контекст — ниже.
 */
export function letter(f: LetterFields): string {
  const site = process.env.SITE_URL?.trim().replace(/\/+$/, '') ?? '';
  const stream = [f.orgSlug, f.streamSlug].filter(Boolean).join(' / ');

  return [
    `Тема: ${f.topic}`,
    '',
    f.message,
    '',
    '—————',
    `Контакт: ${f.contact || 'не указан'}`,
    `Эфир: ${stream || 'не со страницы трансляции'}`,
    `Страница: ${f.pageUrl || 'неизвестна'}`,
    `Время: ${f.createdAt.toISOString()}`,
    `Разбор: ${site}/admin/feedback`,
  ].join('\n');
}

function tooManyRequests(): HttpException {
  return new HttpException(
    'Слишком много обращений. Попробуйте позже.',
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/**
 * Текст ошибки уходит прямо в форму зрителю, поэтому label — по-русски, а
 * формулировки «не короче/не длиннее» не требуют согласования с числом.
 */
function requiredText(value: unknown, label: string, limits: { min: number; max: number }): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < limits.min) {
    throw new BadRequestException(`${label}: не короче ${limits.min} символов`);
  }
  if (text.length > limits.max) {
    throw new BadRequestException(`${label}: не длиннее ${limits.max} символов`);
  }
  return text;
}

/** Пустое и слишком длинное одинаково превращаются в аккуратное значение. */
function optionalText(value: unknown, max: number): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return text.slice(0, max);
}
