import { clientIp } from './client-ip';

function req(headers: Record<string, string | string[]>, ip?: string) {
  return { headers, ip } as any;
}

describe('clientIp', () => {
  it('предпочитает X-Real-IP — его nginx перезаписывает безусловно', () => {
    expect(
      clientIp(req({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' }, '10.0.0.2')),
    ).toBe('203.0.113.7');
  });

  it('берёт первый адрес из X-Forwarded-For, когда X-Real-IP нет', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1, 10.0.0.2' }))).toBe(
      '203.0.113.7',
    );
  });

  it('падает на req.ip без единого прокси-заголовка', () => {
    expect(clientIp(req({}, '203.0.113.7'))).toBe('203.0.113.7');
  });

  it('приводит IPv4-mapped IPv6 к обычному виду', () => {
    expect(clientIp(req({}, '::ffff:203.0.113.7'))).toBe('203.0.113.7');
  });

  it('возвращает null, когда адрес определить нечем', () => {
    expect(clientIp(req({}))).toBeNull();
    expect(clientIp(req({ 'x-real-ip': '  ' }, ''))).toBeNull();
  });

  it('переживает заголовок, пришедший массивом', () => {
    expect(clientIp(req({ 'x-real-ip': ['203.0.113.7', '198.51.100.1'] }))).toBe('203.0.113.7');
  });
});
