import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

export interface JwtPayload {
  sub: string;
  role: 'superadmin' | 'org_admin';
  orgId?: string;
  orgSlug?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(login: string, password: string) {
    // Try superadmin first
    const user = await this.prisma.user.findUnique({ where: { login } });
    if (user) {
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) throw new UnauthorizedException('Invalid credentials');
      const payload: JwtPayload = { sub: user.id, role: 'superadmin' };
      const token = await this.jwt.signAsync(payload);
      return { token, role: 'superadmin' as const, login: user.login };
    }

    // Try org_admin
    const org = await this.prisma.organization.findUnique({ where: { slug: login } });
    if (!org) throw new UnauthorizedException('Invalid credentials');
    if (!org.isActive) throw new UnauthorizedException('Organization is disabled');
    const valid = await bcrypt.compare(password, org.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    const payload: JwtPayload = { sub: org.id, role: 'org_admin', orgId: org.id, orgSlug: org.slug };
    const token = await this.jwt.signAsync(payload);
    return { token, role: 'org_admin' as const, orgId: org.id, orgSlug: org.slug, login: org.slug };
  }
}
