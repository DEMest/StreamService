import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Request, Response, CookieOptions } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { JwtPayload } from './auth.service';

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';

const ACCESS_MAX_AGE_MS = 60 * 60 * 1000;            // 1 час
const REFRESH_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 дней

/**
 * Флаг Secure для auth cookie. Если задана COOKIE_SECURE — берём её (true/false),
 * иначе fallback по NODE_ENV (production → secure). На HTTP-тест-стенде нужно
 * COOKIE_SECURE=false, иначе браузер молча выкинет cookie и /me будет 401.
 */
function cookieSecure(): boolean {
  const v = process.env.COOKIE_SECURE;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

function accessCookieOpts(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    maxAge: ACCESS_MAX_AGE_MS,
    path: '/',
  };
}

function refreshCookieOpts(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    maxAge: REFRESH_MAX_AGE_MS,
    path: '/',
  };
}

function pickOrgId(result: { orgId?: string }): string | null {
  return 'orgId' in result && result.orgId ? result.orgId : null;
}

/**
 * Мобильный клиент (NFR-34/NFR-60) запрашивает токены в JSON заголовком
 * `X-Client: app`. Без него ответ как раньше — только role/login/orgId:
 * иначе 90-дневный refresh оказывается в теле login/refresh и его может
 * украсть XSS, хотя cookie по-прежнему HttpOnly.
 */
function wantsBodyTokens(req: Request): boolean {
  const raw = req.headers['x-client'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim().toLowerCase() === 'app';
}

function sessionBody(
  result: {
    accessToken: string;
    refreshToken: string;
    role: string;
    login: string;
    orgId?: string;
  },
  includeTokens: boolean,
) {
  const base = {
    role: result.role,
    login: result.login,
    orgId: pickOrgId(result),
  };
  if (!includeTokens) return base;
  return {
    ...base,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  };
}

@Controller('v1/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Req() req: Request,
    @Body() body: { login: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.login, body.password);
    res.cookie(ACCESS_COOKIE, result.accessToken, accessCookieOpts());
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOpts());
    return sessionBody(result, wantsBodyTokens(req));
  }

  /**
   * POST /v1/auth/refresh — cookie refresh_token или body.refreshToken
   * (мобильный клиент без cookie jar). Rotation: новая пара access+refresh.
   * Без валидного refresh — 401.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Body() body: { refreshToken?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const fromCookie = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '';
    const fromBody = typeof body?.refreshToken === 'string' ? body.refreshToken.trim() : '';
    // Cookie первым: сайт шлёт оба канала только случайно; мобильный — только body.
    const raw = fromCookie || fromBody;
    if (!raw) throw new UnauthorizedException('No refresh token');
    const result = await this.auth.refresh(raw);
    res.cookie(ACCESS_COOKIE, result.accessToken, accessCookieOpts());
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOpts());
    return sessionBody(result, wantsBodyTokens(req));
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    const clearOpts: CookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      secure: cookieSecure(),
      path: '/',
    };
    res.clearCookie(ACCESS_COOKIE, clearOpts);
    res.clearCookie(REFRESH_COOKIE, clearOpts);
    return { ok: true };
  }

  /**
   * GET /v1/auth/me — текущий пользователь (id, role, orgId/orgSlug).
   * Используется для hydration состояния авторизации в UI.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtPayload) {
    return user;
  }
}
