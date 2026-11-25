import { INestApplication } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import { AddressInfo } from 'net';
import { APP_CLIENT_HEADER, APP_CLIENT_VALUE } from './access-token';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * Acceptance #130: один и тот же защищённый эндпоинт (/v1/auth/me)
 * отвечает и с cookie, и с Authorization Bearer.
 */
describe('GET /v1/auth/me — cookie и Bearer', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let baseUrl: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({ secret: 'test-me-secret' })],
      controllers: [AuthController],
      providers: [
        JwtAuthGuard,
        {
          provide: AuthService,
          useValue: { login: jest.fn(), refresh: jest.fn() },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.use(cookieParser());
    await app.init();
    await app.listen(0);
    const addr = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    jwt = module.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function signAccess() {
    return jwt.signAsync(
      { sub: 'u1', role: 'org_admin', orgId: 'org-1', orgSlug: 'club', type: 'access' },
      { expiresIn: '1h' },
    );
  }

  it('отвечает 200 с cookie access_token', async () => {
    const token = await signAccess();
    const res = await fetch(`${baseUrl}/v1/auth/me`, {
      headers: { cookie: `access_token=${token}` },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      sub: 'u1',
      role: 'org_admin',
      orgId: 'org-1',
    });
  });

  it('отвечает 200 с Authorization Bearer без cookie', async () => {
    const token = await signAccess();
    const res = await fetch(`${baseUrl}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      sub: 'u1',
      role: 'org_admin',
      orgId: 'org-1',
    });
  });

  it('login с X-Client: app возвращает токены; ими можно вызвать /me', async () => {
    const accessToken = await signAccess();
    const refreshToken = await jwt.signAsync(
      { sub: 'u1', role: 'org_admin', orgId: 'org-1', orgSlug: 'club', type: 'refresh' },
      { expiresIn: '90d' },
    );
    const auth = app.get(AuthService) as { login: jest.Mock };
    auth.login.mockResolvedValue({
      accessToken,
      refreshToken,
      role: 'org_admin',
      login: 'club',
      orgId: 'org-1',
    });

    const loginRes = await fetch(`${baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [APP_CLIENT_HEADER]: APP_CLIENT_VALUE,
      },
      body: JSON.stringify({ login: 'club', password: 'x' }),
    });
    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.accessToken).toBe(accessToken);

    const meRes = await fetch(`${baseUrl}/v1/auth/me`, {
      headers: { Authorization: `Bearer ${loginBody.accessToken}` },
    });
    expect(meRes.status).toBe(200);
  });
});
