import axios from 'axios';
import { TelegramService } from './telegram.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TelegramService', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    jest.clearAllMocks();
    // isAxiosError мок-модуль не подставляет — возвращаем ему поведение.
    (mockedAxios as unknown as { isAxiosError: unknown }).isAxiosError = () => false;
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('без настроек молча отказывается, не бросая', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;

    const svc = new TelegramService();
    expect(svc.isConfigured()).toBe(false);
    await expect(svc.send('тест')).resolves.toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('пустой токен считается отсутствующим', () => {
    process.env.TELEGRAM_BOT_TOKEN = '   ';
    process.env.TELEGRAM_CHAT_ID = '42';
    expect(new TelegramService().isConfigured()).toBe(false);
  });

  it('отправляет сообщение в указанный чат', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    process.env.TELEGRAM_CHAT_ID = '42';
    mockedAxios.post.mockResolvedValue({ data: { ok: true } });

    await expect(new TelegramService().send('канал занят')).resolves.toBe(true);

    const [url, body] = mockedAxios.post.mock.calls[0];
    expect(url).toContain('/bottoken/sendMessage');
    expect(body).toMatchObject({ chat_id: '42', text: 'канал занят' });
  });

  it('сетевая ошибка не превращается в исключение', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'token';
    process.env.TELEGRAM_CHAT_ID = '42';
    mockedAxios.post.mockRejectedValue(new Error('нет сети'));

    await expect(new TelegramService().send('тест')).resolves.toBe(false);
  });
});
