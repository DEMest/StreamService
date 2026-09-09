import { Logger, UnauthorizedException } from '@nestjs/common';
import {
  MediamtxWebhookController,
  MEDIAMTX_AUTH_RATE_MAX,
} from './mediamtx-webhook.controller';
import { StreamService } from '../stream/stream.service';

const mockStream = {
  verifyIngestKey: jest.fn(),
  handleWebhook: jest.fn(),
};

describe('MediamtxWebhookController', () => {
  let controller: MediamtxWebhookController;
  const originalSecret = process.env.MEDIAMTX_WEBHOOK_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStream.verifyIngestKey.mockResolvedValue(true);
    mockStream.handleWebhook.mockResolvedValue(undefined);
    controller = new MediamtxWebhookController(mockStream as unknown as StreamService);
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.MEDIAMTX_WEBHOOK_SECRET;
    else process.env.MEDIAMTX_WEBHOOK_SECRET = originalSecret;
    jest.restoreAllMocks();
  });

  describe('handleWebhook — fail-closed на пустой секрет', () => {
    it('пустой секрет отклоняет запрос, даже если заголовок авторизации совпал бы с ним', async () => {
      delete process.env.MEDIAMTX_WEBHOOK_SECRET;
      await expect(
        controller.handleWebhook('Bearer undefined', { action: 'publish', path: 'live/org' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockStream.handleWebhook).not.toHaveBeenCalled();
    });

    it('пустой секрет отклоняет запрос вообще без заголовка авторизации', async () => {
      delete process.env.MEDIAMTX_WEBHOOK_SECRET;
      await expect(
        controller.handleWebhook(undefined as unknown as string, {
          action: 'publish',
          path: 'live/org',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('заданный секрет с верным заголовком пропускает запрос как раньше', async () => {
      process.env.MEDIAMTX_WEBHOOK_SECRET = 'topsecret';
      await controller.handleWebhook('Bearer topsecret', { action: 'publish', path: 'live/org' });
      expect(mockStream.handleWebhook).toHaveBeenCalledWith('live/org', 'publish');
    });

    it('заданный секрет с неверным заголовком по-прежнему отклоняется', async () => {
      process.env.MEDIAMTX_WEBHOOK_SECRET = 'topsecret';
      await expect(
        controller.handleWebhook('Bearer wrong', { action: 'publish', path: 'live/org' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mockStream.handleWebhook).not.toHaveBeenCalled();
    });

    it('логирует ошибку при старте, если секрет не задан', () => {
      delete process.env.MEDIAMTX_WEBHOOK_SECRET;
      const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      controller.onModuleInit();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('MEDIAMTX_WEBHOOK_SECRET'));
    });

    it('не логирует ошибку при старте, если секрет задан', () => {
      process.env.MEDIAMTX_WEBHOOK_SECRET = 'topsecret';
      const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      controller.onModuleInit();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('handleAuth — лимит попыток по IP', () => {
    const publishBody = (ip: string) => ({
      action: 'publish',
      protocol: 'rtmp',
      path: 'live/org/stream',
      password: 'some-key',
      ip,
    });

    it('пропускает RTMP-publish и бьёт в БД, пока квота не исчерпана', async () => {
      for (let i = 0; i < MEDIAMTX_AUTH_RATE_MAX; i++) {
        await expect(controller.handleAuth(publishBody('1.2.3.4'))).resolves.toEqual({ ok: true });
      }
      expect(mockStream.verifyIngestKey).toHaveBeenCalledTimes(MEDIAMTX_AUTH_RATE_MAX);
    });

    it('следующая попытка сверх лимита отклоняется без похода в БД', async () => {
      for (let i = 0; i < MEDIAMTX_AUTH_RATE_MAX; i++) {
        await controller.handleAuth(publishBody('1.2.3.4'));
      }
      mockStream.verifyIngestKey.mockClear();

      await expect(controller.handleAuth(publishBody('1.2.3.4'))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(mockStream.verifyIngestKey).not.toHaveBeenCalled();
    });

    it('лимит считается независимо по каждому адресу', async () => {
      for (let i = 0; i < MEDIAMTX_AUTH_RATE_MAX; i++) {
        await controller.handleAuth(publishBody('1.2.3.4'));
      }
      await expect(controller.handleAuth(publishBody('5.6.7.8'))).resolves.toEqual({ ok: true });
    });

    it('SRT publish не тратит квоту RTMP-лимитера', async () => {
      for (let i = 0; i < MEDIAMTX_AUTH_RATE_MAX; i++) {
        await controller.handleAuth({ action: 'publish', protocol: 'srt', ip: '1.2.3.4' });
      }
      // Квота цела — RTMP-попытка с того же адреса всё ещё проходит.
      await expect(
        controller.handleAuth(publishBody('1.2.3.4')),
      ).resolves.toEqual({ ok: true });
    });

    it('действие play (не publish) не участвует в лимите вообще', async () => {
      for (let i = 0; i < MEDIAMTX_AUTH_RATE_MAX + 5; i++) {
        await expect(
          controller.handleAuth({ action: 'read', ip: '1.2.3.4' }),
        ).resolves.toEqual({ ok: true });
      }
      expect(mockStream.verifyIngestKey).not.toHaveBeenCalled();
    });
  });
});
