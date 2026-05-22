import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';

export type WsAuthUser = {
  sub: string;
  role: 'superadmin' | 'org_admin';
  orgId?: string;
  orgSlug?: string;
};

/**
 * Guard для WebSocket-handler'ов. Читает JWT из `access_token` cookie
 * в handshake'е, верифицирует и кладёт payload в `client.data.user`.
 *
 * Применять через `@UseGuards(WsJwtGuard)` на gateway или конкретном handler'е.
 * После активации `client.data.user` гарантированно содержит {@link WsAuthUser}.
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(private jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const client = ctx.switchToWs().getClient<Socket>();

    // Если уже авторизованы в этом сокете (handleConnection вызвал guard через verify) — пропускаем.
    if (client.data?.user) return true;

    const user = await verifyWsToken(client, this.jwt);
    if (!user) return false;
    client.data.user = user;
    return true;
  }
}

/**
 * Извлекает JWT из cookie сокета и верифицирует. Возвращает payload или null.
 *
 * Вынесено отдельной функцией чтобы могло использоваться в `handleConnection`
 * (где guard'ы не вызываются автоматически).
 */
export async function verifyWsToken(
  client: Socket,
  jwt: JwtService,
): Promise<WsAuthUser | null> {
  const cookieHeader =
    (client.handshake.headers['cookie'] as string | undefined) ?? '';
  const token = parseCookie(cookieHeader, 'access_token');
  if (!token) return null;
  try {
    return (await jwt.verifyAsync(token)) as WsAuthUser;
  } catch {
    return null;
  }
}

function parseCookie(header: string, name: string): string | null {
  if (!header) return null;
  const parts = header.split(';');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    if (key === name) {
      const value = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}
