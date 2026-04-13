import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);
    if (!required) return true;
    const user = ctx.switchToHttp().getRequest()['user'];
    if (!user) throw new UnauthorizedException('Not authenticated');
    if (!required.includes(user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}
