import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

function ctx(req: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as any;
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwt: { verifyAsync: jest.Mock };

  beforeEach(() => {
    jwt = { verifyAsync: jest.fn() };
    guard = new JwtAuthGuard(jwt as unknown as JwtService);
  });

  it('пускает с cookie access_token', async () => {
    const req: Record<string, unknown> = { cookies: { access_token: 'c' }, headers: {} };
    jwt.verifyAsync.mockResolvedValue({ sub: '1', role: 'superadmin', type: 'access' });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req['user']).toEqual({ sub: '1', role: 'superadmin', type: 'access' });
  });

  it('пускает с Authorization Bearer без cookie', async () => {
    const req: Record<string, unknown> = {
      cookies: {},
      headers: { authorization: 'Bearer mobile-access' },
    };
    jwt.verifyAsync.mockResolvedValue({ sub: '2', role: 'org_admin', type: 'access' });
    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(jwt.verifyAsync).toHaveBeenCalledWith('mobile-access');
    expect(req['user']).toMatchObject({ sub: '2', role: 'org_admin' });
  });

  it('без токена — 401', async () => {
    await expect(guard.canActivate(ctx({ cookies: {}, headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('refresh-токен на API — 401', async () => {
    const req = { cookies: { access_token: 'r' }, headers: {} };
    jwt.verifyAsync.mockResolvedValue({ sub: '1', role: 'superadmin', type: 'refresh' });
    await expect(guard.canActivate(ctx(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
