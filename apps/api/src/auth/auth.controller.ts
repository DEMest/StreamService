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

@Controller('v1/auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { login: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body.login, body.password);
    res.cookie(ACCESS_COOKIE, result.accessToken, accessCookieOpts());
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOpts());
    return { role: result.role, login: result.login, orgId: pickOrgId(result) };
  }

  /**
   * POST /v1/auth/refresh — читает refresh-cookie, выдаёт новую пару
   * (rotation: новый refresh тоже, чтобы сессия скользила). Не требует
   * access-токена. При невалидном/протухшем refresh — 401, фронт редиректит
   * на /login.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = (req.cookies?.[REFRESH_COOKIE] as string | undefined) ?? '';
    if (!raw) throw new UnauthorizedException('No refresh token');
    const result = await this.auth.refresh(raw);
    res.cookie(ACCESS_COOKIE, result.accessToken, accessCookieOpts());
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOpts());
    return { role: result.role, login: result.login, orgId: pickOrgId(result) };
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
