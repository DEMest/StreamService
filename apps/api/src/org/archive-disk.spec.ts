import * as fs from 'fs';
import { isLocalS3, readArchiveDisk } from './archive-disk';

const statfsOf = (st: Partial<fs.StatsFs>) => () => ({ bsize: 4096, ...st }) as fs.StatsFs;

describe('isLocalS3', () => {
  it.each([
    ['http://minio:9000', true],
    ['http://streamservice-minio:9000', true],
    ['http://localhost:9000', true],
    ['https://minio.s3-provider.com', false],
    ['https://s3.eu-central-1.amazonaws.com', false],
    ['не url', false],
    ['', false],
  ])('%s → %s', (endpoint, expected) => {
    expect(isLocalS3(endpoint)).toBe(expected);
  });
});

describe('readArchiveDisk', () => {
  const OLD = process.env.S3_ENDPOINT;
  afterEach(() => {
    if (OLD === undefined) delete process.env.S3_ENDPOINT;
    else process.env.S3_ENDPOINT = OLD;
  });

  it('внешний S3 — диск не меряем и statfs не зовём', () => {
    process.env.S3_ENDPOINT = 'https://s3.eu-central-1.amazonaws.com';
    const statfs = jest.fn();
    expect(readArchiveDisk(statfs)).toEqual({ disk: null, diskStatus: 'external' });
    expect(statfs).not.toHaveBeenCalled();
  });

  it('свободно — то, что доступно непривилегированному процессу; root-резерв вычтен и из объёма', () => {
    process.env.S3_ENDPOINT = 'http://minio:9000';
    const r = readArchiveDisk(statfsOf({ blocks: 1000, bfree: 300, bavail: 250 }));
    expect(r).toEqual({
      disk: { totalBytes: 950 * 4096, freeBytes: 250 * 4096 },
      diskStatus: 'ok',
    });
  });

  it('сбой statfs — unavailable с текстом ошибки, а не исключение', () => {
    process.env.S3_ENDPOINT = 'http://minio:9000';
    const r = readArchiveDisk(() => {
      throw new Error('ENOENT');
    });
    expect(r.disk).toBeNull();
    expect(r.diskStatus).toBe('unavailable');
    expect(r.error).toContain('/recordings');
    expect(r.error).toContain('ENOENT');
  });
});
