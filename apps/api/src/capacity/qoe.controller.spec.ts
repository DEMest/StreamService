import { QoeController, QOE_RATE_MAX } from './qoe.controller';
import { QoeService } from './qoe.service';

const mockQoe = { ingest: jest.fn() };

function req(ip: string) {
  return { headers: {}, ip } as any;
}

const validBody = { streamKey: 'org/stream', clientId: 'client-1' };

describe('QoeController', () => {
  let controller: QoeController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new QoeController(mockQoe as unknown as QoeService);
  });

  it('принимает отчёты, пока квота по адресу не исчерпана', () => {
    for (let i = 0; i < QOE_RATE_MAX; i++) {
      controller.report({ ...validBody, clientId: `c${i}` }, req('1.2.3.4'));
    }
    expect(mockQoe.ingest).toHaveBeenCalledTimes(QOE_RATE_MAX);
  });

  it('отчёт сверх лимита с того же адреса молча отбрасывается', () => {
    for (let i = 0; i < QOE_RATE_MAX; i++) {
      controller.report({ ...validBody, clientId: `c${i}` }, req('1.2.3.4'));
    }
    mockQoe.ingest.mockClear();

    controller.report({ ...validBody, clientId: 'overflow' }, req('1.2.3.4'));
    expect(mockQoe.ingest).not.toHaveBeenCalled();
  });

  it('лимит считается независимо по каждому адресу', () => {
    for (let i = 0; i < QOE_RATE_MAX; i++) {
      controller.report({ ...validBody, clientId: `c${i}` }, req('1.2.3.4'));
    }
    controller.report(validBody, req('5.6.7.8'));
    expect(mockQoe.ingest).toHaveBeenLastCalledWith(expect.objectContaining({ clientId: 'client-1' }));
  });

  it('невалидный отчёт по-прежнему отбрасывается ещё до лимитера', () => {
    controller.report({ streamKey: 'bad key', clientId: 'a' }, req('9.9.9.9'));
    expect(mockQoe.ingest).not.toHaveBeenCalled();
  });
});
