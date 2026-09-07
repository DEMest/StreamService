import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../notify/mail.service';
import { AD_MANAGER_ROLE } from '../auth/auth.service';

const DEFAULT_LOGIN = 'admanager';

/**
 * Алфавит без визуально спорных знаков (O/0, l/1/I): пароль читают из письма и
 * вводят руками, и «нолик или буква?» — ровно та ошибка, которую не хочется
 * потом разбирать по телефону.
 */
export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const PASSWORD_LENGTH = 20;

/** Максимальное значение байта, при котором остаток от деления не смещён. */
const UNBIASED_MAX = 256 - (256 % ALPHABET.length);

export function generatePassword(): string {
  let out = '';
  while (out.length < PASSWORD_LENGTH) {
    for (const byte of randomBytes(PASSWORD_LENGTH)) {
      // Хвост диапазона отбрасываем: без этого первые символы алфавита
      // выпадали бы чаще остальных (modulo bias).
      if (byte >= UNBIASED_MAX) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === PASSWORD_LENGTH) break;
    }
  }
  return out;
}

/**
 * Адрес входа менеджера — тот же сайт на поддомене `ads.`. Хост выводится из
 * SITE_URL, а не задаётся своей переменной: одно имя, посчитанное из другого,
 * не умеет с ним разъехаться.
 */
function adsLoginUrl(): string | null {
  const raw = process.env.SITE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hostname = `ads.${url.hostname}`;
    return `${url.origin}/login`;
  } catch {
    return null;
  }
}

/**
 * Заводит аккаунт рекламного менеджера при старте API, если его ещё нет.
 *
 * Живёт в модуле рекламы, а не рядом с созданием суперадмина в AdminService:
 * роль `ad_manager` существует только ради этой фичи, и вырезав `ads`, вырежешь
 * её целиком. AdminService.onModuleInit к тому же уже делает две несвязанные
 * вещи — суперадмина и восстановление путей MediaMTX.
 *
 * Пароль генерируется и показывается ровно один раз: в логе и письмом. Забыли —
 * удалите строку из User и перезапустите API, он создаст аккаунт заново.
 */
@Injectable()
export class AdManagerBootstrap implements OnModuleInit {
  private readonly logger = new Logger(AdManagerBootstrap.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureAccount();
    } catch (e) {
      // Аккаунт рекламщика — не то, ради чего стоит не поднять API: на этом
      // сервере идут трансляции. Ошибка видна в логе, следующий старт повторит.
      this.logger.error(
        `Не удалось создать аккаунт рекламного менеджера: ${(e as Error).message}`,
      );
    }
  }

  private async ensureAccount(): Promise<void> {
    // Ищем по роли, а не по логину: аккаунт могли переименовать прямо в БД, и
    // поиск по имени завёл бы при следующем рестарте второй, «правильный».
    const existing = await this.prisma.user.findFirst({ where: { role: AD_MANAGER_ROLE } });
    if (existing) return;

    const login = await this.freeLogin();
    const password = generatePassword();
    await this.prisma.user.create({
      data: { login, passwordHash: await bcrypt.hash(password, 10), role: AD_MANAGER_ROLE },
    });

    const url = adsLoginUrl();
    const where = url ? `Вход: ${url}` : 'Вход: /login на поддомене ads.<ваш домен>';

    this.logger.log(
      [
        '',
        '════════════════════════════════════════════════',
        ' Создан аккаунт рекламного менеджера',
        `   логин:  ${login}`,
        `   пароль: ${password}`,
        `   ${where}`,
        ' Пароль показан один раз и больше нигде не хранится',
        ' в открытом виде.',
        '════════════════════════════════════════════════',
      ].join('\n'),
    );

    // Письмо — основной канал: SSH к серверу у владельца может не быть, а лог
    // живёт до ротации. По контракту MailService.send не бросает и не
    // отклоняется, поэтому лежащий SMTP не может помешать создать аккаунт.
    void this.mail.send(
      'Liga Live: создан аккаунт рекламного менеджера',
      [
        'Аккаунт для управления рекламой создан автоматически при запуске API.',
        '',
        `Логин:  ${login}`,
        `Пароль: ${password}`,
        where,
        '',
        'Пароль сгенерирован автоматически и больше нигде не хранится в открытом',
        'виде. Потеряли — удалите этого пользователя из таблицы User и',
        'перезапустите API: он создаст аккаунт заново и пришлёт новый пароль.',
      ].join('\n'),
    );
  }

  /**
   * Логин по умолчанию может быть занят — например, суперадмина назвали так же.
   * Падать из-за этого нельзя: старт API не должен зависеть от чужого имени.
   */
  private async freeLogin(): Promise<string> {
    const taken = await this.prisma.user.findUnique({ where: { login: DEFAULT_LOGIN } });
    if (!taken) return DEFAULT_LOGIN;
    return `${DEFAULT_LOGIN}-${randomBytes(2).toString('hex')}`;
  }
}
