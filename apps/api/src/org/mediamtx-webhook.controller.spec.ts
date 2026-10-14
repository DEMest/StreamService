import { UnauthorizedException } from '@nestjs/common';
import { MediamtxWebhookController } from './mediamtx-webhook.controller';

describe('MediamtxWebhookController.handleAuth — чтение потока', () => {
  const stream = { verifyIngestKey: jest.fn(), handleWebhook: jest.fn() };
  const controller = new MediamtxWebhookController(stream as any);

  beforeEach(() => jest.clearAllMocks());

  it('пускает FFmpeg из on-ready.sh: read по RTSP изнутри контейнера', async () => {
    await expect(
      controller.handleAuth({ action: 'read', protocol: 'rtsp', path: 'live/club/court', ip: '127.0.0.1' }),
    ).resolves.toEqual({ ok: true });
  });

  it.each(['rtmp', 'srt', 'webrtc', 'hls'])('не пускает read по %s — ингест-порты открыты наружу', async (protocol) => {
    await expect(
      controller.handleAuth({ action: 'read', protocol, path: 'live/club/court', ip: '203.0.113.7' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('не пускает playback (записи MediaMTX) ни по какому протоколу', async () => {
    await expect(
      controller.handleAuth({ action: 'playback', protocol: 'rtsp', path: 'live/club/court', ip: '203.0.113.7' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('публикация по SRT по-прежнему принимается (passphrase проверяет транспорт)', async () => {
    await expect(
      controller.handleAuth({ action: 'publish', protocol: 'srt', path: 'live/club/court' }),
    ).resolves.toEqual({ ok: true });
  });

  it('публикация по RTMP по-прежнему проверяет ingestKey', async () => {
    stream.verifyIngestKey.mockResolvedValue(true);
    await expect(
      controller.handleAuth({ action: 'publish', protocol: 'rtmp', path: 'live/club/court', query: 'key=abc' }),
    ).resolves.toEqual({ ok: true });
    expect(stream.verifyIngestKey).toHaveBeenCalledWith('club', 'court', 'abc');
  });
});
