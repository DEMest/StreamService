import axios from 'axios';
import { INDEXNOW_KEY, IndexNowService } from './indexnow.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('IndexNowService', () => {
  let service: IndexNowService;
  const originalSiteUrl = process.env.SITE_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SITE_URL = 'https://liga-live.ru';
    delete process.env.INDEXNOW_KEY;
    service = new IndexNowService();
  });

  afterAll(() => {
    if (originalSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = originalSiteUrl;
  });

  it('отправляет host, ключ и keyLocation на тот же домен', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: '' } as any);

    const ok = await service.submit(['https://liga-live.ru/watch/liga/main']);

    expect(ok).toBe(true);
    const [url, body] = mockedAxios.post.mock.calls[0];
    expect(url).toBe('https://api.indexnow.org/indexnow');
    expect(body).toEqual({
      host: 'liga-live.ru',
      key: INDEXNOW_KEY,
      keyLocation: `https://liga-live.ru/${INDEXNOW_KEY}.txt`,
      urlList: ['https://liga-live.ru/watch/liga/main'],
    });
  });

  it('202 (ключ ещё проверяется) считается успехом', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 202, data: '' } as any);

    expect(await service.submit(['https://liga-live.ru/'])).toBe(true);
  });

  it('403 (ключ не найден на сайте) — неуспех, но без исключения', async () => {
    mockedAxios.post.mockResolvedValueOnce({ status: 403, data: 'Forbidden' } as any);

    expect(await service.submit(['https://liga-live.ru/'])).toBe(false);
  });

  it('сетевая ошибка не выпускается наружу — эфир важнее пинга', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(service.submit(['https://liga-live.ru/'])).resolves.toBe(false);
  });

  it('без SITE_URL не ходит в сеть вообще', async () => {
    process.env.SITE_URL = '';

    expect(await service.submit(['https://liga-live.ru/'])).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('пустой список URL не отправляется', async () => {
    expect(await service.submit([])).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('ключ можно переопределить через env', async () => {
    process.env.INDEXNOW_KEY = 'deadbeef';
    mockedAxios.post.mockResolvedValueOnce({ status: 200, data: '' } as any);

    await service.submit(['https://liga-live.ru/']);

    const [, body] = mockedAxios.post.mock.calls[0] as any;
    expect(body.key).toBe('deadbeef');
    expect(body.keyLocation).toBe('https://liga-live.ru/deadbeef.txt');
  });
});
