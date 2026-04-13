import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

const hash = (p: string) => bcrypt.hashSync(p, 10);

const mockPrisma = {
  user: { findUnique: jest.fn() },
  organization: { findUnique: jest.fn() },
};

const mockJwt = { signAsync: jest.fn().mockResolvedValue('token') };

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('returns token for valid superadmin credentials', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: '1', login: 'admin', passwordHash: hash('pass'), role: 'superadmin',
    });
    const result = await service.login('admin', 'pass');
    expect(result.token).toBe('token');
    expect(result.role).toBe('superadmin');
  });

  it('returns token for valid org_admin credentials', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org1', slug: 'club', passwordHash: hash('key'), isActive: true,
    });
    const result = await service.login('club', 'key');
    expect(result.role).toBe('org_admin');
    expect(result.orgId).toBe('org1');
  });

  it('throws UnauthorizedException for wrong password', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: '1', login: 'admin', passwordHash: hash('pass'), role: 'superadmin',
    });
    await expect(service.login('admin', 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws UnauthorizedException for inactive org', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.organization.findUnique.mockResolvedValue({
      id: 'org1', slug: 'club', passwordHash: hash('key'), isActive: false,
    });
    await expect(service.login('club', 'key')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
