import axios from 'axios';
import { generateKeyPairSync } from 'crypto';
import { GoogleIndexingService } from './google-indexing.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Настоящая пара ключей — иначе подпись JWT не проверить по-честному. */
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const credentials = JSON.stringify({
  client_email: 'indexer@liga-live.iam.gserviceaccount.com',
  // В .env ключ хранится с литеральными \n — сервис должен их развернуть сам.
  private_key: (privateKey as string).replace(/\n/g, '\\n'),
});

describe('GoogleIndexingService', () => {
  let service: GoogleIndexingService;
  const original = {
    site: process.env.SITE_URL,
    creds: process.env.GOOGLE_INDEXING_CREDENTIALS,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SITE_URL = 'https://liga-live.ru';
    process.env.GOOGLE_INDEXING_CREDENTIALS = credentials;
    service = new GoogleIndexingService();
  });

  afterAll(() => {
    if (original.site === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = original.site;
    if (original.creds === undefined) delete process.env.GOOGLE_INDEXING_CREDENTIALS;
    else process.env.GOOGLE_INDEXING_CREDENTIALS = original.creds;
  });

  it('выключен, пока в env нет сервис-аккаунта', async () => {
    delete process.env.GOOGLE_INDEXING_CREDENTIALS;

    expect(service.enabled).toBe(false);
    expect(await service.publish('https://liga-live.ru/watch/liga/main')).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('выключен на локальном стенде даже с ключом', () => {
    process.env.SITE_URL = 'http://localhost:3000';

    expect(service.enabled).toBe(false);
  });

  it('меняет подписанный JWT на токен и публикует URL', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ status: 200, data: { access_token: 'ya29.token', expires_in: 3600 } } as any)
      .mockResolvedValueOnce({ status: 200, data: {} } as any);

    const ok = await service.publish('https://liga-live.ru/watch/liga/main');

    expect(ok).toBe(true);

    const [tokenUrl, tokenBody] = mockedAxios.post.mock.calls[0] as any;
    expect(tokenUrl).toBe('https://oauth2.googleapis.com/token');
    const params = new URLSearchParams(tokenBody);
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    // Три сегмента = header.claims.signature; claims должны нести scope indexing.
    const assertion = params.get('assertion')!;
    const [, claimsB64] = assertion.split('.');
    const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString('utf8'));
    expect(assertion.split('.')).toHaveLength(3);
    expect(claims).toMatchObject({
      iss: 'indexer@liga-live.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/indexing',
      aud: 'https://oauth2.googleapis.com/token',
    });

    const [publishUrl, publishBody, publishCfg] = mockedAxios.post.mock.calls[1] as any;
    expect(publishUrl).toBe('https://indexing.googleapis.com/v3/urlNotifications:publish');
    expect(publishBody).toEqual({ url: 'https://liga-live.ru/watch/liga/main', type: 'URL_UPDATED' });
    expect(publishCfg.headers.Authorization).toBe('Bearer ya29.token');
  });

  it('переиспользует токен между публикациями', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ status: 200, data: { access_token: 'ya29.token', expires_in: 3600 } } as any)
      .mockResolvedValue({ status: 200, data: {} } as any);

    await service.publish('https://liga-live.ru/watch/liga/a');
    await service.publish('https://liga-live.ru/watch/liga/b');

    // 1 запрос за токеном + 2 публикации, а не 2 + 2.
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
  });

  it('исчерпанная квота (429) не бросает исключение', async () => {
    mockedAxios.post
      .mockResolvedValueOnce({ status: 200, data: { access_token: 'ya29.token', expires_in: 3600 } } as any)
      .mockResolvedValueOnce({ status: 429, data: { error: 'quota' } } as any);

    await expect(service.publish('https://liga-live.ru/watch/liga/main')).resolves.toBe(false);
  });

  it('принимает те же credentials в base64', async () => {
    process.env.GOOGLE_INDEXING_CREDENTIALS = Buffer.from(credentials, 'utf8').toString('base64');
    mockedAxios.post
      .mockResolvedValueOnce({ status: 200, data: { access_token: 'ya29.token', expires_in: 3600 } } as any)
      .mockResolvedValueOnce({ status: 200, data: {} } as any);

    expect(await service.publish('https://liga-live.ru/watch/liga/main')).toBe(true);
  });

  it('битые credentials не роняют сервис', async () => {
    process.env.GOOGLE_INDEXING_CREDENTIALS = '{not json';

    expect(service.enabled).toBe(false);
    await expect(service.publish('https://liga-live.ru/watch/liga/main')).resolves.toBe(false);
  });
});
