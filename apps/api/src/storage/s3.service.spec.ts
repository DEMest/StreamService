import { mockClient } from 'aws-sdk-client-mock';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { S3Service } from './s3.service';
import * as fs from 'fs';
import { Readable } from 'stream';

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed-url'),
}));

/**
 * lib-storage `Upload` с маленьким потоком (< partSize) отправляет одиночный
 * PutObjectCommand через тот же замоканный S3Client — существующие assertions
 * по commandCalls(PutObjectCommand) остаются валидными.
 */
function mockReadStream(): jest.SpyInstance {
  return jest.spyOn(fs, 'createReadStream').mockImplementation(
    () => Readable.from(Buffer.from('fake-bytes')) as any,
  );
}

describe('S3Service', () => {
  const s3Mock = mockClient(S3Client);
  let service: S3Service;

  beforeEach(() => {
    s3Mock.reset();
    process.env.S3_BUCKET = 'test-bucket';
    process.env.S3_ENDPOINT = 'http://minio:9000';
    process.env.S3_PUBLIC_ENDPOINT = 'http://localhost:9000';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY_ID = 'test-key';
    process.env.S3_SECRET_ACCESS_KEY = 'test-secret';
    process.env.S3_FORCE_PATH_STYLE = 'true';
    service = new S3Service();
  });

  describe('uploadDirectory', () => {
    it('uploads every file in a nested directory under the given key prefix', async () => {
      jest.spyOn(fs, 'readdirSync').mockImplementation((dirPath: any, opts?: any) => {
        if (String(dirPath) === '/scratch/broadcast1') {
          return [
            { name: 'master.m3u8', isDirectory: () => false },
            { name: 'slot-1', isDirectory: () => true },
          ] as any;
        }
        if (String(dirPath) === '/scratch/broadcast1/slot-1') {
          return [{ name: 'seg-0001.mp4', isDirectory: () => false }] as any;
        }
        return [] as any;
      });
      mockReadStream();

      await service.uploadDirectory('/scratch/broadcast1', 'archive/org/stream/broadcast1');

      const calls = s3Mock.commandCalls(PutObjectCommand);
      expect(calls.length).toBe(2);
      const keys = calls.map((c) => c.args[0].input.Key).sort();
      expect(keys).toEqual([
        'archive/org/stream/broadcast1/master.m3u8',
        'archive/org/stream/broadcast1/slot-1/seg-0001.mp4',
      ]);

      jest.restoreAllMocks();
    });

    it('sets application/vnd.apple.mpegurl content-type for .m3u8 and no-cache', async () => {
      jest.spyOn(fs, 'readdirSync').mockReturnValue([
        { name: 'master.m3u8', isDirectory: () => false },
      ] as any);
      mockReadStream();

      await service.uploadDirectory('/scratch/b1', 'archive/b1');

      const call = s3Mock.commandCalls(PutObjectCommand)[0];
      expect(call.args[0].input.ContentType).toBe('application/vnd.apple.mpegurl');
      expect(call.args[0].input.CacheControl).toBe('no-cache');

      jest.restoreAllMocks();
    });

    it('sets video/mp4 content-type and long-lived immutable cache for .mp4', async () => {
      jest.spyOn(fs, 'readdirSync').mockReturnValue([
        { name: 'download.mp4', isDirectory: () => false },
      ] as any);
      mockReadStream();

      await service.uploadDirectory('/scratch/b1', 'archive/b1');

      const call = s3Mock.commandCalls(PutObjectCommand)[0];
      expect(call.args[0].input.ContentType).toBe('video/mp4');
      expect(call.args[0].input.CacheControl).toBe('public, max-age=31536000, immutable');

      jest.restoreAllMocks();
    });

    it('streams file bodies (createReadStream), never buffers whole files via readFileSync', async () => {
      // Сегменты MediaMTX (3h) могут превышать 2 GiB Buffer-лимит Node —
      // readFileSync здесь был бы бомбой замедленного действия.
      jest.spyOn(fs, 'readdirSync').mockReturnValue([
        { name: 'download.mp4', isDirectory: () => false },
      ] as any);
      const streamSpy = mockReadStream();
      const readFileSpy = jest.spyOn(fs, 'readFileSync');

      await service.uploadDirectory('/scratch/b1', 'archive/b1');

      expect(streamSpy).toHaveBeenCalled();
      expect(readFileSpy).not.toHaveBeenCalled();

      jest.restoreAllMocks();
    });
  });

  describe('getObjectText', () => {
    it('returns the object body as string (playlist proxying)', async () => {
      s3Mock.on(GetObjectCommand).resolves({
        Body: { transformToString: async () => '#EXTM3U\nslot-1/index.m3u8\n' },
      } as any);

      const text = await service.getObjectText('archive/b1/master.m3u8');

      expect(text).toContain('#EXTM3U');
      const call = s3Mock.commandCalls(GetObjectCommand)[0];
      expect(call.args[0].input.Key).toBe('archive/b1/master.m3u8');
      expect(call.args[0].input.Bucket).toBe('test-bucket');
    });
  });

  describe('getPresignedUrl', () => {
    it('returns a signed URL for the given key', async () => {
      const url = await service.getPresignedUrl('archive/b1/master.m3u8');
      expect(url).toBe('https://s3.example.com/signed-url');
    });
  });

  describe('deleteByPrefix', () => {
    it('does nothing when no objects match the prefix', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({ Contents: [], IsTruncated: false });
      await service.deleteByPrefix('archive/empty');
      expect(s3Mock.commandCalls(DeleteObjectsCommand).length).toBe(0);
    });

    it('lists and batch-deletes all objects under the prefix', async () => {
      s3Mock.on(ListObjectsV2Command).resolves({
        Contents: [{ Key: 'archive/b1/master.m3u8' }, { Key: 'archive/b1/slot-1/seg-0001.mp4' }],
        IsTruncated: false,
      });

      await service.deleteByPrefix('archive/b1');

      const call = s3Mock.commandCalls(DeleteObjectsCommand)[0];
      expect(call.args[0].input.Delete?.Objects).toEqual([
        { Key: 'archive/b1/master.m3u8' },
        { Key: 'archive/b1/slot-1/seg-0001.mp4' },
      ]);
    });

    it('paginates through ListObjectsV2 when results are truncated', async () => {
      s3Mock
        .on(ListObjectsV2Command)
        .resolvesOnce({ Contents: [{ Key: 'a' }], IsTruncated: true, NextContinuationToken: 'page2' })
        .resolvesOnce({ Contents: [{ Key: 'b' }], IsTruncated: false });

      await service.deleteByPrefix('archive/paged');

      expect(s3Mock.commandCalls(ListObjectsV2Command).length).toBe(2);
      const call = s3Mock.commandCalls(DeleteObjectsCommand)[0];
      expect(call.args[0].input.Delete?.Objects).toEqual([{ Key: 'a' }, { Key: 'b' }]);
    });
  });
});
