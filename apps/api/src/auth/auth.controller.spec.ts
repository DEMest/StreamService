import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

function req(headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  return { headers, cookies } as any;
}

describe('AuthController', () => {
  let controller: AuthController;
  let auth: {
    login: jest.Mock;
    refresh: jest.Mock;
  };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };

  beforeEach(() => {
    auth = {
      login: jest.fn(),
      refresh: jest.fn(),
    };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
    controller = new AuthController(auth as unknown as AuthService);
  });

  it('login для сайта: cookies есть, токенов в body нет', async () => {
    auth.login.mockResolvedValue({
      accessToken: 'a1',
      refreshToken: 'r1',
      role: 'org_admin',
      login: 'club',
      orgId: 'org-1',
    });
    const body = await controller.login(req(), { login: 'club', password: 'x' }, res as any);
    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      'a1',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'r1',
      expect.objectContaining({ httpOnly: true }),
    );
    expect(body).toEqual({ role: 'org_admin', login: 'club', orgId: 'org-1' });
    expect(body).not.toHaveProperty('accessToken');
    expect(body).not.toHaveProperty('refreshToken');
  });

  it('login с X-Client: app отдаёт токены в body', async () => {
    auth.login.mockResolvedValue({
      accessToken: 'a1',
      refreshToken: 'r1',
      role: 'org_admin',
      login: 'club',
      orgId: 'org-1',
    });
    const body = await controller.login(
      req({ 'x-client': 'app' }),
      { login: 'club', password: 'x' },
      res as any,
    );
    expect(body).toEqual({
      role: 'org_admin',
      login: 'club',
      orgId: 'org-1',
      accessToken: 'a1',
      refreshToken: 'r1',
    });
  });

  it('refresh принимает refreshToken из body без cookie (приложение)', async () => {
    auth.refresh.mockResolvedValue({
      accessToken: 'a2',
      refreshToken: 'r2',
      role: 'superadmin',
      login: 'admin',
    });
    const body = await controller.refresh(
      req({ 'x-client': 'app' }),
      { refreshToken: 'old-refresh' },
      res as any,
    );
    expect(auth.refresh).toHaveBeenCalledWith('old-refresh');
    expect(body).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' });
  });

  it('refresh предпочитает cookie, если есть и cookie, и body', async () => {
    auth.refresh.mockResolvedValue({
      accessToken: 'a3',
      refreshToken: 'r3',
      role: 'superadmin',
      login: 'admin',
    });
    await controller.refresh(
      req({}, { refresh_token: 'from-cookie' }),
      { refreshToken: 'from-body' },
      res as any,
    );
    expect(auth.refresh).toHaveBeenCalledWith('from-cookie');
  });

  it('refresh без cookie и body — 401', async () => {
    await expect(
      controller.refresh(req(), {}, res as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
