import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { createSign } from 'crypto';
import { publicSiteUrl } from './site-url';

/**
 * Google Indexing API — единственный способ сказать Google «переобходи вот
 * этот URL прямо сейчас» программно (в IndexNow Google не участвует).
 *
 * Важное ограничение самого Google: API принимает только страницы с разметкой
 * `JobPosting` или `BroadcastEvent`. Нам подходит второе — страница идущего
 * эфира отдаёт VideoObject + BroadcastEvent (см. apps/web/src/lib/json-ld.ts),
 * поэтому пингуем ТОЛЬКО страницы трансляций и только когда эфир реально
 * начался или закончился. Слать сюда лендинг или каталог нельзя — это
 * нарушение условий использования, а не просто бесполезный вызов.
 *
 * Выключен, пока в env нет сервис-аккаунта: `GOOGLE_INDEXING_CREDENTIALS` —
 * JSON ключа сервис-аккаунта целиком, как есть или в base64.
 */

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const PUBLISH_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications:publish';
const SCOPE = 'https://www.googleapis.com/auth/indexing';
const TIMEOUT_MS = 8_000;
/** Обновляем токен чуть раньше срока, чтобы не словить 401 на границе. */
const TOKEN_SKEW_MS = 60_000;

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export type UrlNotificationType = 'URL_UPDATED' | 'URL_DELETED';

@Injectable()
export class GoogleIndexingService {
  private readonly logger = new Logger(GoogleIndexingService.name);
  private token: { value: string; expiresAt: number } | null = null;

  get enabled(): boolean {
    return publicSiteUrl() !== null && this.credentials() !== null;
  }

  /**
   * Уведомить Google об обновлении страницы. Никогда не бросает — вызывается
   * из обработки webhook'а вокруг живого эфира.
   */
  async publish(url: string, type: UrlNotificationType = 'URL_UPDATED'): Promise<boolean> {
    if (!this.enabled) return false;

    const token = await this.accessToken();
    if (!token) return false;

    try {
      const res = await axios.post(
        PUBLISH_ENDPOINT,
        { url, type },
        {
          timeout: TIMEOUT_MS,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          validateStatus: () => true,
        },
      );
      if (res.status === 200) {
        this.logger.log(`Google Indexing: ${type} ${url}`);
        return true;
      }
      // 429 — исчерпана суточная квота (по умолчанию 200 URL/сутки). Это не
      // повод чинить эфир: страница всё равно попадёт в индекс через sitemap.
      this.logger.warn(
        `Google Indexing отклонил ${url}: HTTP ${res.status} ${JSON.stringify(res.data ?? '')}`,
      );
      if (res.status === 401) this.token = null; // протухший токен — перевыпустим
      return false;
    } catch (e: any) {
      this.logger.warn(`Google Indexing недоступен: ${e?.message ?? e}`);
      return false;
    }
  }

  /** Сервис-аккаунт из env: сырой JSON или тот же JSON в base64. */
  private credentials(): ServiceAccount | null {
    const raw = (process.env.GOOGLE_INDEXING_CREDENTIALS ?? '').trim();
    if (!raw) return null;

    const json = raw.startsWith('{') ? raw : safeBase64Decode(raw);
    if (!json) return null;

    try {
      const parsed = JSON.parse(json);
      const email = parsed?.client_email;
      // В .env перенос строки не сохранить — приватный ключ приезжает с
      // литеральными \n, их нужно вернуть в настоящие переводы строк.
      const key = typeof parsed?.private_key === 'string' ? parsed.private_key.replace(/\\n/g, '\n') : null;
      if (typeof email !== 'string' || !email || !key) {
        this.logger.warn('GOOGLE_INDEXING_CREDENTIALS без client_email/private_key — пинг Google выключен');
        return null;
      }
      return { client_email: email, private_key: key };
    } catch {
      this.logger.warn('GOOGLE_INDEXING_CREDENTIALS не разбирается как JSON — пинг Google выключен');
      return null;
    }
  }

  /**
   * OAuth2-токен по схеме service account JWT bearer: подписываем claim-set
   * приватным ключом сервис-аккаунта и меняем его на access_token. Отдельная
   * библиотека (google-auth-library) ради этого в зависимости не тянется —
   * всё это тридцать строк на встроенном crypto.
   */
  private async accessToken(): Promise<string | null> {
    if (this.token && this.token.expiresAt - TOKEN_SKEW_MS > Date.now()) {
      return this.token.value;
    }
    const creds = this.credentials();
    if (!creds) return null;

    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64Url(
      JSON.stringify({
        iss: creds.client_email,
        scope: SCOPE,
        aud: TOKEN_ENDPOINT,
        iat: now,
        exp: now + 3600,
      }),
    );

    let assertion: string;
    try {
      const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(creds.private_key);
      assertion = `${header}.${claims}.${signature.toString('base64url')}`;
    } catch (e: any) {
      this.logger.warn(`Не удалось подписать JWT сервис-аккаунта: ${e?.message ?? e}`);
      return null;
    }

    try {
      const res = await axios.post(
        TOKEN_ENDPOINT,
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }).toString(),
        {
          timeout: TIMEOUT_MS,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
        },
      );
      if (res.status !== 200 || !res.data?.access_token) {
        this.logger.warn(`Google OAuth отказал: HTTP ${res.status} ${JSON.stringify(res.data ?? '')}`);
        return null;
      }
      const expiresIn = Number(res.data.expires_in) || 3600;
      this.token = { value: res.data.access_token, expiresAt: Date.now() + expiresIn * 1000 };
      return this.token.value;
    } catch (e: any) {
      this.logger.warn(`Google OAuth недоступен: ${e?.message ?? e}`);
      return null;
    }
  }
}

function base64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function safeBase64Decode(input: string): string | null {
  try {
    return Buffer.from(input, 'base64').toString('utf8');
  } catch {
    return null;
  }
}
