import {
  DEFAULT_RTMP_PORT,
  DEFAULT_SRT_PORT,
  readIngestConfig,
} from './ingest-config';

describe('readIngestConfig', () => {
  it('без переменных отдаёт host=null и дефолтные порты', () => {
    expect(readIngestConfig({})).toEqual({
      host: null,
      srtPort: DEFAULT_SRT_PORT,
      rtmpPort: DEFAULT_RTMP_PORT,
    });
  });

  it('host=null и при пустой строке, и при пробелах — фронт должен уйти на window.location', () => {
    expect(readIngestConfig({ INGEST_HOST: '' }).host).toBeNull();
    expect(readIngestConfig({ INGEST_HOST: '   ' }).host).toBeNull();
  });

  it('берёт заданные порты', () => {
    const cfg = readIngestConfig({ MEDIAMTX_SRT_PORT: '9999', MEDIAMTX_RTMP_PORT: '1936' });
    expect(cfg.srtPort).toBe(9999);
    expect(cfg.rtmpPort).toBe(1936);
  });

  describe('нормализация INGEST_HOST', () => {
    it.each([
      ['media.example.com', 'media.example.com'],
      ['  media.example.com  ', 'media.example.com'],
      ['srt://media.example.com', 'media.example.com'],
      ['https://media.example.com/', 'media.example.com'],
      ['rtmp://media.example.com/live', 'media.example.com'],
      ['203.0.113.10', '203.0.113.10'],
      // Порт в host оставляем как есть: убрать его — значит молча выкинуть то,
      // что человек написал осознанно. Строка подключения тогда выйдет с двумя
      // портами, и ошибка будет видна сразу, а не «адрес не работает».
      ['media.example.com:8890', 'media.example.com:8890'],
    ])('%s -> %s', (raw, expected) => {
      expect(readIngestConfig({ INGEST_HOST: raw }).host).toBe(expected);
    });
  });

  describe('некорректный порт', () => {
    it.each([['abc'], ['0'], ['65536'], ['-1'], ['8890.5']])(
      'MEDIAMTX_SRT_PORT=%s откатывается на дефолт и предупреждает',
      (raw) => {
        const warn = jest.fn();
        const cfg = readIngestConfig({ MEDIAMTX_SRT_PORT: raw }, warn);
        expect(cfg.srtPort).toBe(DEFAULT_SRT_PORT);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('MEDIAMTX_SRT_PORT');
      },
    );

    it('на валидном значении не предупреждает', () => {
      const warn = jest.fn();
      readIngestConfig({ MEDIAMTX_SRT_PORT: '8890', MEDIAMTX_RTMP_PORT: '1935' }, warn);
      expect(warn).not.toHaveBeenCalled();
    });

    it('не роняет процесс — API должен подниматься даже с опечаткой в env', () => {
      expect(() => readIngestConfig({ MEDIAMTX_RTMP_PORT: 'нет' })).not.toThrow();
    });
  });
});
