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

const mockJwt = {
  signAsync: jest.fn().mockResolvedValue('token'),
  verifyAsync: jest.fn(),
};

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
    expect(result.accessToken).toBe('token');
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

  it('выдаёт роль ad_manager пользователю с этой ролью в БД, а не superadmin', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u2', login: 'admanager', passwordHash: hash('pass'), role: 'ad_manager',
    });
    const result = await service.login('admanager', 'pass');
    expect(result.role).toBe('ad_manager');
  });

  it('неизвестную роль в БД трактует как superadmin — это дефолт схемы', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u3', login: 'legacy', passwordHash: hash('pass'), role: 'что-то своё',
    });
    const result = await service.login('legacy', 'pass');
    expect(result.role).toBe('superadmin');
  });

  it('refresh перечитывает роль ad_manager из БД, а не берёт её из токена', async () => {
    mockJwt.verifyAsync.mockResolvedValue({ sub: 'u2', role: 'ad_manager', type: 'refresh' });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u2', login: 'admanager', passwordHash: hash('pass'), role: 'ad_manager',
    });
    const result = await service.refresh('raw-refresh-token');
    expect(result.role).toBe('ad_manager');
    expect(result.login).toBe('admanager');
  });
});
