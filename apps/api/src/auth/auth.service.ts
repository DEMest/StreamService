import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

export interface JwtPayload {
  sub: string;
  role: 'superadmin' | 'org_admin' | 'ad_manager';
  orgId?: string;
  orgSlug?: string;
  /** Тип токена. Если undefined — legacy access (старые куки до миграции). */
  type?: 'access' | 'refresh';
}

/**
 * Роль рекламного менеджера. Константа, а не литерал по месту: строка живёт
 * ещё и в запросе к БД (`where: { role }`), где union-тип `JwtPayload` уже не
 * подстрахует от опечатки.
 */
export const AD_MANAGER_ROLE = 'ad_manager';

/**
 * Роль владельца записи в таблице `User`. Пока в ней жил один суперадмин, роль
 * выдавалась литералом прямо в login() — с появлением рекламного менеджера так
 * нельзя: он получил бы полный доступ к админке.
 *
 * Неизвестное значение трактуем как `superadmin`: это дефолт схемы, с которым
 * созданы все строки до миграции, и терять на нём вход было бы хуже, чем
 * сохранить существующее поведение.
 */
function userRole(role: string): 'superadmin' | 'ad_manager' {
  return role === AD_MANAGER_ROLE ? AD_MANAGER_ROLE : 'superadmin';
}

const ACCESS_TTL = '1h';
const REFRESH_TTL = '90d';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  private async signAccess(base: Omit<JwtPayload, 'type'>): Promise<string> {
    return this.jwt.signAsync({ ...base, type: 'access' }, { expiresIn: ACCESS_TTL });
  }

  private async signRefresh(base: Omit<JwtPayload, 'type'>): Promise<string> {
    return this.jwt.signAsync({ ...base, type: 'refresh' }, { expiresIn: REFRESH_TTL });
  }

  async login(login: string, password: string) {
    // Try superadmin first
    const user = await this.prisma.user.findUnique({ where: { login } });
    if (user) {
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) throw new UnauthorizedException('Invalid credentials');
      const role = userRole(user.role);
      const base: Omit<JwtPayload, 'type'> = { sub: user.id, role };
      const accessToken = await this.signAccess(base);
      const refreshToken = await this.signRefresh(base);
      return {
        accessToken,
        refreshToken,
        role,
        login: user.login,
      };
    }

    // Try org_admin
    const org = await this.prisma.organization.findUnique({ where: { slug: login } });
    if (!org) throw new UnauthorizedException('Invalid credentials');
    if (!org.isActive) throw new UnauthorizedException('Organization is disabled');
    const valid = await bcrypt.compare(password, org.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    const base: Omit<JwtPayload, 'type'> = {
      sub: org.id,
      role: 'org_admin',
      orgId: org.id,
      orgSlug: org.slug,
    };
    const accessToken = await this.signAccess(base);
    const refreshToken = await this.signRefresh(base);
    return {
      accessToken,
      refreshToken,
      role: 'org_admin' as const,
      orgId: org.id,
      orgSlug: org.slug,
      login: org.slug,
    };
  }

  /**
   * Принимает refresh-токен из cookie, валидирует и подписывает новую пару
   * (rotation: одновременно новый refresh, чтобы сессия скользила).
   * Идентификатор юзера/орги перечитывается из БД — права/слаг могли измениться.
   */
  async refresh(rawRefresh: string) {
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(rawRefresh);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Not a refresh token');
    }
    // Обе роли из таблицы User обслуживаются одной веткой: роль всё равно
    // перечитывается из БД, поэтому разделять их незачем.
    if (payload.role === 'superadmin' || payload.role === AD_MANAGER_ROLE) {
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user) throw new UnauthorizedException('User not found');
      const role = userRole(user.role);
      const base: Omit<JwtPayload, 'type'> = { sub: user.id, role };
      return {
        accessToken: await this.signAccess(base),
        refreshToken: await this.signRefresh(base),
        role,
        login: user.login,
      };
    }
    if (payload.role === 'org_admin') {
      const org = await this.prisma.organization.findUnique({
        where: { id: payload.orgId ?? '' },
      });
      if (!org) throw new UnauthorizedException('Org not found');
      if (!org.isActive) throw new UnauthorizedException('Organization is disabled');
      const base: Omit<JwtPayload, 'type'> = {
        sub: org.id,
        role: 'org_admin',
        orgId: org.id,
        orgSlug: org.slug,
      };
      return {
        accessToken: await this.signAccess(base),
        refreshToken: await this.signRefresh(base),
        role: 'org_admin' as const,
        orgId: org.id,
        orgSlug: org.slug,
        login: org.slug,
      };
    }
    throw new UnauthorizedException('Unknown role');
  }
}
