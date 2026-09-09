import { HttpException } from '@nestjs/common';
import { SearchController, SEARCH_RATE_MAX } from './search.controller';
import { SearchService } from './search.service';

const mockSearch = { search: jest.fn() };

function req(ip: string) {
  return { headers: {}, ip } as any;
}

function res() {
  return { set: jest.fn() } as any;
}

describe('SearchController — лимит запросов', () => {
  let controller: SearchController;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearch.search.mockResolvedValue({ query: '', organizations: [], streams: [], broadcasts: [] });
    controller = new SearchController(mockSearch as unknown as SearchService);
  });

  it('отвечает, пока квота по адресу не исчерпана', () => {
    for (let i = 0; i < SEARCH_RATE_MAX; i++) {
      controller.find('вега', req('1.2.3.4'), res());
    }
    expect(mockSearch.search).toHaveBeenCalledTimes(SEARCH_RATE_MAX);
  });

  it('запрос сверх лимита с того же адреса получает 429 и не идёт в сервис', () => {
    for (let i = 0; i < SEARCH_RATE_MAX; i++) {
      controller.find('вега', req('1.2.3.4'), res());
    }
    mockSearch.search.mockClear();

    expect(() => controller.find('вега', req('1.2.3.4'), res())).toThrow(HttpException);
    expect(mockSearch.search).not.toHaveBeenCalled();
  });

  it('лимит считается независимо по каждому адресу', () => {
    for (let i = 0; i < SEARCH_RATE_MAX; i++) {
      controller.find('вега', req('1.2.3.4'), res());
    }
    expect(() => controller.find('вега', req('5.6.7.8'), res())).not.toThrow();
  });

  it('успешный ответ ставит Cache-Control, отклонённый — нет', () => {
    const okRes = res();
    controller.find('вега', req('9.9.9.9'), okRes);
    expect(okRes.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=30');

    for (let i = 0; i < SEARCH_RATE_MAX; i++) {
      controller.find('вега', req('10.10.10.10'), res());
    }
    const blockedRes = res();
    expect(() => controller.find('вега', req('10.10.10.10'), blockedRes)).toThrow();
    expect(blockedRes.set).not.toHaveBeenCalled();
  });
});
