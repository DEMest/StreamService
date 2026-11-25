import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { extractHttpAccessToken } from './access-token';
import type { JwtPayload } from './auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = extractHttpAccessToken(req);
    if (!token) throw new UnauthorizedException('Not authenticated');
    try {
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);
      // Refresh-токен не должен пускать на обычные endpoint'ы. type undefined
      // — legacy access (до миграции на пару access/refresh), считаем валидным.
      if (payload.type === 'refresh') {
        throw new UnauthorizedException('Refresh token cannot be used for API calls');
      }
      req['user'] = payload;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Invalid or expired token');
    }
    return true;
  }
}
