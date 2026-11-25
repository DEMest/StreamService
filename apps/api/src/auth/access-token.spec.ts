import { bearerFromAuthorization, extractHttpAccessToken, extractSocketAccessToken } from './access-token';

describe('access-token helpers', () => {
  describe('bearerFromAuthorization', () => {
    it('достаёт токен из Bearer', () => {
      expect(bearerFromAuthorization('Bearer abc.def')).toBe('abc.def');
      expect(bearerFromAuthorization('bearer xyz')).toBe('xyz');
    });

    it('пусто на мусоре и отсутствии схемы', () => {
      expect(bearerFromAuthorization(undefined)).toBeUndefined();
      expect(bearerFromAuthorization('Basic x')).toBeUndefined();
      expect(bearerFromAuthorization('Bearer')).toBeUndefined();
    });
  });

  describe('extractHttpAccessToken', () => {
    it('Authorization важнее cookie', () => {
      expect(
        extractHttpAccessToken({
          headers: { authorization: 'Bearer from-header' },
          cookies: { access_token: 'from-cookie' },
        }),
      ).toBe('from-header');
    });

    it('без заголовка берёт cookie', () => {
      expect(
        extractHttpAccessToken({
          headers: {},
          cookies: { access_token: 'from-cookie' },
        }),
      ).toBe('from-cookie');
    });
  });

  describe('extractSocketAccessToken', () => {
    it('предпочитает handshake.auth.token', () => {
      expect(
        extractSocketAccessToken({
          auth: { token: 'auth-token' },
          headers: { authorization: 'Bearer hdr' },
        }),
      ).toBe('auth-token');
    });

    it('иначе читает Authorization', () => {
      expect(
        extractSocketAccessToken({
          auth: {},
          headers: { authorization: 'Bearer hdr' },
        }),
      ).toBe('hdr');
    });
  });
});
