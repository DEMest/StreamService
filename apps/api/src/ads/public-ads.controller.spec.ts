import { PublicAdsController, AD_EVENT_RATE_MAX } from './public-ads.controller';
import { AdsService } from './ads.service';

const mockAds = { recordEvent: jest.fn() };

function req(ip: string) {
  return { headers: {}, ip } as any;
}

const validBody = { placement: 'watch', kind: 'impression' };

describe('PublicAdsController — лимит событий', () => {
  let controller: PublicAdsController;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAds.recordEvent.mockResolvedValue(undefined);
    controller = new PublicAdsController(mockAds as unknown as AdsService);
  });

  it('пишет события, пока квота по адресу не исчерпана', async () => {
    for (let i = 0; i < AD_EVENT_RATE_MAX; i++) {
      await controller.event('ad-1', validBody, req('1.2.3.4'));
    }
    expect(mockAds.recordEvent).toHaveBeenCalledTimes(AD_EVENT_RATE_MAX);
  });

  it('событие сверх лимита с того же адреса молча отбрасывается', async () => {
    for (let i = 0; i < AD_EVENT_RATE_MAX; i++) {
      await controller.event('ad-1', validBody, req('1.2.3.4'));
    }
    mockAds.recordEvent.mockClear();

    await controller.event('ad-1', validBody, req('1.2.3.4'));
    expect(mockAds.recordEvent).not.toHaveBeenCalled();
  });

  it('лимит считается независимо по каждому адресу', async () => {
    for (let i = 0; i < AD_EVENT_RATE_MAX; i++) {
      await controller.event('ad-1', validBody, req('1.2.3.4'));
    }
    await controller.event('ad-1', validBody, req('5.6.7.8'));
    expect(mockAds.recordEvent).toHaveBeenCalledWith('ad-1', 'watch', 'impression', null);
  });
});
