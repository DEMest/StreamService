import { Test } from '@nestjs/testing';
import { RecordingService } from './recording.service';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../storage/s3.service';
import { NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { makeFmp4 } from './fmp4.fixture-spec';

// We mock child_process with actual module spread to avoid breaking Prisma's node:child_process.
// The execFile mock here is not used directly — instead we spy on service.probeMp4 below.
jest.mock('child_process', () => {
  const actual = jest.requireActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    default: actual,
  };
});

const mockPrisma = {
  recording: {
    create: jest.fn(),
    update: jest.fn(),
    // Захват записи на повтор (failed → processing): по умолчанию удаётся.
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
  },
  broadcast: {
    findMany: jest.fn(),
    // Более поздней трансляции у стрима по умолчанию нет.
    findFirst: jest.fn().mockResolvedValue(null),
    // Дефолтный resolved-результат: часть НЕ-preview тестов (spyExistsSync
    // мокается true для ВСЕХ путей, в т.ч. случайно для preview.jpg) иначе
    // получила бы undefined и упала бы на `.catch()` в uploadAndFinalize.
    update: jest.fn().mockResolvedValue({}),
    updateMany: jest.fn(),
  },
  stream: {
    update: jest.fn(),
  },
};

const mockS3 = {
  uploadFiles: jest.fn().mockResolvedValue(undefined),
  deleteByPrefix: jest.fn().mockResolvedValue(undefined),
  getPresignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed'),
  getObjectText: jest.fn(),
  getObjectSize: jest.fn(),
  getObjectRange: jest.fn(),
  putObject: jest.fn().mockResolvedValue(undefined),
};

/** Даёт пайплайну исходники: каталог существует и в нём лежат сегменты. */
function withSources(spyExists: jest.SpyInstance, spyReaddir: jest.SpyInstance, files = ['seg-0001.mp4']) {
  spyExists.mockReturnValue(true);
  spyReaddir.mockImplementation((_p: any, opts?: any) => {
    if (opts && (opts as any).withFileTypes) return [];
    return files as any;
  });
}

/** Дать отработать фоновым цепочкам промисов. */
async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

describe('RecordingService', () => {
  let service: RecordingService;

  // fs spies per-test
  let spyExistsSync: jest.SpyInstance;
  let spyReaddirSync: jest.SpyInstance;
  let spyMkdirSync: jest.SpyInstance;
  let spyRenameSync: jest.SpyInstance;
  let spyWriteFileSync: jest.SpyInstance;
  let spyStatSync: jest.SpyInstance;
  let spyRmSync: jest.SpyInstance;
  // Ссылка на глобальный спай buildPreviewJpeg из beforeEach — нужна тесту
  // guard'а «сегмент не существует», который обязан вызвать РЕАЛЬНЫЙ метод
  // (mockRestore() внутри одного it, beforeEach переустановит спай заново
  // для следующих тестов).
  let spyBuildPreviewJpeg: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Spy on individual fs methods — avoids breaking Prisma platform detection
    spyExistsSync = jest.spyOn(fs, 'existsSync').mockReturnValue(false as any);
    spyReaddirSync = jest.spyOn(fs, 'readdirSync').mockReturnValue([] as any);
    spyMkdirSync = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
    spyRenameSync = jest.spyOn(fs, 'renameSync').mockImplementation(() => undefined);
    spyWriteFileSync = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
    spyStatSync = jest.spyOn(fs, 'statSync').mockReturnValue({ size: 0, isDirectory: () => false } as any);
    spyRmSync = jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined);

    const module = await Test.createTestingModule({
      providers: [
        RecordingService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: S3Service, useValue: mockS3 },
      ],
    }).compile();
    service = module.get(RecordingService);

    // Spy on private probeMp4 to avoid needing a real ffprobe binary
    jest.spyOn(service as any, 'probeMp4').mockResolvedValue({
      duration: 10.5,
      width: 1920,
      height: 1080,
    });
    jest.spyOn(service as any, 'buildDownloadMp4').mockResolvedValue(undefined);
    // Оглавление download.mp4 — свой модуль со своими тестами (fmp4-index.spec);
    // здесь важно только, что пайплайн кладёт плейлист и длительность.
    jest.spyOn(service as any, 'vodFromFile').mockResolvedValue({
      playlist: '#EXTM3U\n#EXT-X-MAP:URI="download.mp4",BYTERANGE="1296@0"\n',
      duration: 10.5,
    });
    // Превью — авто-кадр из ffmpeg; мокаем глобально, чтобы существующие
    // convert-тесты не спавнили реальный ffmpeg-процесс. Тесты превью ниже
    // переопределяют этот спай под свой сценарий.
    spyBuildPreviewJpeg = jest.spyOn(service as any, 'buildPreviewJpeg').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('onStreamEnded', () => {
    it('creates Recording with slotIndex:1 when segments exist', async () => {
      spyExistsSync.mockReturnValue(true);
      spyReaddirSync.mockImplementation((_p: any, opts?: any) => {
        if (opts && (opts as any).withFileTypes) return [];
        return ['seg-001.mp4', 'seg-002.mp4'] as any;
      });

      mockPrisma.recording.create.mockResolvedValue({ id: 'r1', slotIndex: 1 });
      mockPrisma.recording.update.mockResolvedValue({});

      await service.onStreamEnded('bcast1', 'org1');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(mockPrisma.recording.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            broadcastId: 'bcast1',
            slotIndex: 1,
            status: 'processing',
          }),
        }),
      );
    });

    it('skips when segments directory does not exist', async () => {
      spyExistsSync.mockReturnValue(false);
      await service.onStreamEnded('bcast1', 'org1');
      expect(mockPrisma.recording.create).not.toHaveBeenCalled();
    });

    it('skips when segments directory is empty (no mp4 files)', async () => {
      spyExistsSync.mockReturnValue(true);
      spyReaddirSync.mockReturnValue([] as any);
      await service.onStreamEnded('bcast1', 'org1');
      expect(mockPrisma.recording.create).not.toHaveBeenCalled();
    });

    it('updates Recording with status ready and manifestPath ending in master.m3u8 after conversion', async () => {
      spyExistsSync.mockReturnValue(true);
      spyReaddirSync.mockImplementation((_p: any, opts?: any) => {
        if (opts && (opts as any).withFileTypes) return [];
        return ['seg-001.mp4'] as any;
      });

      mockPrisma.recording.create.mockResolvedValue({ id: 'r2', slotIndex: 1 });
      mockPrisma.recording.update.mockResolvedValue({});

      await service.onStreamEnded('bcast2', 'orgA');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      // В S3 уезжают склейка и плейлисты — но не исходные сегменты slot-1/.
      expect(mockS3.uploadFiles).toHaveBeenCalledWith(
        expect.stringContaining(path.join('archive', 'orgA', 'bcast2')),
        ['download.mp4', 'vod.m3u8', 'master.m3u8', 'preview.jpg'],
        'archive/orgA/bcast2',
      );
      expect(spyRmSync).toHaveBeenCalledWith(
        expect.stringContaining(path.join('archive', 'orgA', 'bcast2')),
        { recursive: true, force: true },
      );
      expect(mockPrisma.recording.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r2' },
          data: expect.objectContaining({
            status: 'ready',
            manifestPath: 'archive/orgA/bcast2/master.m3u8',
            duration: 11,
          }),
        }),
      );
    });

    it('marks Recording failed and keeps local broadcastDir when S3 upload fails', async () => {
      spyExistsSync.mockReturnValue(true);
      spyReaddirSync.mockImplementation((_p: any, opts?: any) => {
        if (opts && (opts as any).withFileTypes) return [];
        return ['seg-001.mp4'] as any;
      });

      mockPrisma.recording.create.mockResolvedValue({ id: 'r-fail', slotIndex: 1 });
      mockPrisma.recording.update.mockResolvedValue({});
      mockS3.uploadFiles.mockRejectedValueOnce(new Error('S3 unreachable'));

      await service.onStreamEnded('bcast-fail', 'orgFail');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(mockPrisma.recording.update).toHaveBeenCalledWith({
        where: { id: 'r-fail' },
        data: { status: 'failed' },
      });
      expect(spyRmSync).not.toHaveBeenCalled();
    });

    it('creates exactly one Recording with slotIndex=1 (composite)', async () => {
      spyExistsSync.mockReturnValue(true);
      spyReaddirSync.mockImplementation((_p: any, opts?: any) => {
        if (opts && (opts as any).withFileTypes) return [];
        return ['seg-001.mp4'] as any;
      });

      let nextId = 1;
      mockPrisma.recording.create.mockImplementation(({ data }: any) =>
        Promise.resolve({ id: `r${nextId++}`, slotIndex: data.slotIndex }),
      );
      mockPrisma.recording.update.mockResolvedValue({});

      await service.onStreamEnded('bcast-comp', 'org1');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(mockPrisma.recording.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.recording.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            broadcastId: 'bcast-comp',
            slotIndex: 1,
            status: 'processing',
          }),
        }),
      );
    });

    it('пишет vod.m3u8 и master.m3u8 с единственным variant на него', async () => {
      withSources(spyExistsSync, spyReaddirSync);
      mockPrisma.recording.create.mockResolvedValue({ id: 'rm', slotIndex: 1 });
      mockPrisma.recording.update.mockResolvedValue({});

      const writes: Record<string, string> = {};
      spyWriteFileSync.mockImplementation((p: any, content: any) => {
        writes[path.basename(String(p))] = String(content);
      });

      await service.onStreamEnded('bcast-master', 'orgA');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(writes['vod.m3u8']).toContain('EXT-X-MAP:URI="download.mp4"');
      const master = writes['master.m3u8'];
      expect(master.match(/#EXT-X-STREAM-INF/g)).toHaveLength(1);
      expect(master).toContain('RESOLUTION=1920x1080');
      expect(master).toContain('\nvod.m3u8\n');
      expect(master).not.toContain('slot-1');
    });

    it('fileSize — размер download.mp4: в хранилище запись занимает только его', async () => {
      withSources(spyExistsSync, spyReaddirSync);
      const statted: string[] = [];
      spyStatSync.mockImplementation((p: any) => {
        statted.push(String(p));
        return { size: 4096, isDirectory: () => false } as any;
      });
      mockPrisma.recording.create.mockResolvedValue({ id: 'rsize', slotIndex: 1 });
      mockPrisma.recording.update.mockResolvedValue({});

      await service.onStreamEnded('bcast-size', 'org1');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(statted).toContain(path.join('/recordings', 'archive', 'org1', 'bcast-size', 'download.mp4'));
      expect(mockPrisma.recording.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ready', fileSize: 4096 }) }),
      );
    });

    it('не создаёт запись со сроком хранения — автоудаления нет', async () => {
      withSources(spyExistsSync, spyReaddirSync);
      mockPrisma.recording.create.mockResolvedValue({ id: 'r1', slotIndex: 1 });
      mockPrisma.recording.update.mockResolvedValue({});

      await service.onStreamEnded('bcast1', 'org1');

      expect(mockPrisma.recording.create.mock.calls[0][0].data.expiresAt).toBeUndefined();
    });

    it('склейка короче исходников — запись failed, в S3 ничего не уходит, scratch цел', async () => {
      withSources(spyExistsSync, spyReaddirSync);
      mockPrisma.recording.create.mockResolvedValue({ id: 'r-short', slotIndex: 1 });
      mockPrisma.recording.update.mockResolvedValue({});
      // Настоящая сверка vodFromSource поверх оборванной склейки: 2 фрагмента
      // по 2 с против 10.5 с исходников.
      const short = makeFmp4(2);
      (service as any).vodFromFile.mockImplementation((_p: string, expected: number) =>
        (service as any).vodFromSource(
          { size: short.length, read: async (o: number, l: number) => short.subarray(o, o + l) },
          expected,
        ));
      jest.spyOn(service as any, 'probeMp4').mockResolvedValue({ duration: 600, width: 1920, height: 1080 });

      await service.onStreamEnded('bcast-short', 'org1');
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(mockS3.uploadFiles).not.toHaveBeenCalled();
      expect(spyRmSync).not.toHaveBeenCalled();
      expect(mockPrisma.recording.update).toHaveBeenCalledWith({
        where: { id: 'r-short' },
        data: { status: 'failed' },
      });
    });
  });

  describe('getRecordingKeyPrefix', () => {
    it('uses compound unique key broadcastId_slotIndex', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue(null);
      await expect(service.getRecordingKeyPrefix('bcast1', 1)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.recording.findUnique).toHaveBeenCalledWith({
        where: { broadcastId_slotIndex: { broadcastId: 'bcast1', slotIndex: 1 } },
      });
    });

    it('defaults slotIndex to 1 when not provided', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue(null);
      await expect(service.getRecordingKeyPrefix('bcast1')).rejects.toThrow(NotFoundException);
      expect(mockPrisma.recording.findUnique).toHaveBeenCalledWith({
        where: { broadcastId_slotIndex: { broadcastId: 'bcast1', slotIndex: 1 } },
      });
    });

    it('throws NotFoundException when recording is not ready', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue({
        id: '1', broadcastId: 'b1', slotIndex: 1, status: 'processing', manifestPath: null,
      });
      await expect(service.getRecordingKeyPrefix('b1', 1)).rejects.toThrow(NotFoundException);
    });

    it('returns S3 key prefix (posix dirname of manifestPath) when recording is ready', async () => {
      mockPrisma.recording.findUnique.mockResolvedValue({
        id: '1', broadcastId: 'b1', slotIndex: 1, status: 'ready',
        manifestPath: 'archive/org/b1/master.m3u8',
      });
      const prefix = await service.getRecordingKeyPrefix('b1', 1);
      expect(prefix).toBe('archive/org/b1');
    });
  });

  describe('deleteRecordingsForStreams', () => {
    it('удаляет S3-префиксы всех записей переданных Stream\'ов', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([
        { manifestPath: 'archive/org/s/b1/master.m3u8' },
        { manifestPath: null },
        { manifestPath: 'archive/org/s/b2/master.m3u8' },
      ]);
      await service.deleteRecordingsForStreams(['s1']);
      expect(mockPrisma.recording.findMany).toHaveBeenCalledWith({
        where: { broadcast: { streamId: { in: ['s1'] } } },
        select: { manifestPath: true },
      });
      expect(mockS3.deleteByPrefix.mock.calls.map((c) => c[0])).toEqual(['archive/org/s/b1', 'archive/org/s/b2']);
    });

    it('пустой список — ни запроса', async () => {
      await service.deleteRecordingsForStreams([]);
      expect(mockPrisma.recording.findMany).not.toHaveBeenCalled();
    });
  });

  describe('deleteRecordingByBroadcastId', () => {
    it('uses findMany since broadcastId is no longer unique', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([]);
      await service.deleteRecordingByBroadcastId('bcast1');
      expect(mockPrisma.recording.findMany).toHaveBeenCalledWith({ where: { broadcastId: 'bcast1' } });
    });

    it('does nothing when no recordings exist', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([]);
      await expect(service.deleteRecordingByBroadcastId('none')).resolves.not.toThrow();
    });

    it('calls s3.deleteByPrefix for recordings with a manifestPath', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([
        { id: 'r1', manifestPath: 'archive/org/bcast1/master.m3u8' },
        { id: 'r2', manifestPath: null },
      ]);
      await service.deleteRecordingByBroadcastId('bcast1');
      expect(mockS3.deleteByPrefix).toHaveBeenCalledWith('archive/org/bcast1');
      expect(mockS3.deleteByPrefix).toHaveBeenCalledTimes(1);
    });
  });

  describe('retryFailed', () => {
    const failedRow = {
      id: 'rec-resume',
      broadcastId: 'bcast-resume',
      slotIndex: 1,
      status: 'failed',
      broadcast: {
        streamId: 'stream-a',
        startedAt: new Date('2026-10-01T10:00:00Z'),
        stream: { slug: 'court-a', org: { slug: 'org1' } },
      },
    };

    it('skips recordings where broadcast.stream is null', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([
        {
          id: 'rec1',
          broadcastId: 'b1',
          slotIndex: 1,
          status: 'failed',
          broadcast: { stream: null },
        },
      ]);
      await expect(service.retryFailed()).resolves.not.toThrow();
      expect(mockPrisma.recording.update).not.toHaveBeenCalled();
    });

    it('пересобирает архив из исходников scratch, не заглядывая в live/', async () => {
      // Первая попытка уже перенесла сегменты из live/ в scratch. В live/ к
      // этому моменту может лежать СЛЕДУЮЩАЯ трансляция стрима — трогать её нельзя.
      mockPrisma.recording.findMany.mockResolvedValue([failedRow]);
      mockPrisma.recording.update.mockResolvedValue({});
      const slotDir = path.join('/recordings', 'archive', 'org1/court-a', 'bcast-resume', 'slot-1');
      const listed: string[] = [];
      spyExistsSync.mockReturnValue(true);
      spyReaddirSync.mockImplementation((p: any) => {
        listed.push(String(p));
        return (String(p) === slotDir ? ['seg-0001.mp4', 'seg-0002.mp4'] : []) as any;
      });

      await service.retryFailed();
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(listed).not.toContain(path.join('/recordings', 'live', 'org1/court-a'));
      expect(mockS3.uploadFiles).toHaveBeenCalledWith(
        expect.stringContaining(path.join('archive', 'org1/court-a', 'bcast-resume')),
        expect.arrayContaining(['download.mp4', 'vod.m3u8', 'master.m3u8']),
        'archive/org1/court-a/bcast-resume',
      );
      expect(mockPrisma.recording.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rec-resume' },
          data: expect.objectContaining({
            status: 'ready',
            manifestPath: 'archive/org1/court-a/bcast-resume/master.m3u8',
          }),
        }),
      );
      // Исходники уже на месте — повторный перенос из live/ не запускался.
      expect(spyRenameSync).not.toHaveBeenCalled();
    });

    it('повтор берёт уже готовую склейку, если она проходит сверку, — без новой склейки', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([failedRow]);
      mockPrisma.recording.update.mockResolvedValue({});
      withSources(spyExistsSync, spyReaddirSync); // download.mp4 тоже «существует»
      const concat = jest.spyOn(service as any, 'buildDownloadMp4');

      await service.retryFailed();
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(concat).not.toHaveBeenCalled();
      expect(mockS3.uploadFiles).toHaveBeenCalled();
    });

    it('повтор склеивает заново, если готовая склейка сверку не проходит', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([failedRow]);
      mockPrisma.recording.update.mockResolvedValue({});
      withSources(spyExistsSync, spyReaddirSync);
      (service as any).vodFromFile
        .mockRejectedValueOnce(new Error('truncated mdat'))
        .mockResolvedValueOnce({ playlist: '#EXTM3U\n', duration: 10.5 });
      const concat = jest.spyOn(service as any, 'buildDownloadMp4');

      await service.retryFailed();
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      expect(concat).toHaveBeenCalledTimes(1);
      expect(mockS3.uploadFiles).toHaveBeenCalled();
    });

    it('marks the recording failed again when the rebuild also fails', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([failedRow]);
      mockPrisma.recording.update.mockResolvedValue({});
      withSources(spyExistsSync, spyReaddirSync);
      mockS3.uploadFiles.mockRejectedValueOnce(new Error('S3 still unreachable'));

      await service.retryFailed();
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setImmediate(r));
      }

      // Без возврата в 'failed' запись зависла бы в 'processing' навсегда —
      // следующий прогон крона её не увидел бы.
      expect(mockPrisma.recording.update).toHaveBeenCalledWith({
        where: { id: 'rec-resume' },
        data: { status: 'failed' },
      });
    });

    it('запись, которую уже взял другой прогон, не пересобирается второй раз', async () => {
      // Крон и resumeInterrupted выбрали одну failed-запись: захват (failed →
      // processing) удаётся только одному, второй её пропускает.
      mockPrisma.recording.findMany.mockResolvedValue([failedRow]);
      mockPrisma.recording.updateMany.mockResolvedValueOnce({ count: 0 });
      withSources(spyExistsSync, spyReaddirSync);
      const build = jest.spyOn(service as any, 'buildAndUpload');

      await service.retryFailed();

      expect(mockPrisma.recording.updateMany).toHaveBeenCalledWith({
        where: { id: 'rec-resume', status: 'failed' },
        data: { status: 'processing' },
      });
      expect(build).not.toHaveBeenCalled();
      expect(mockS3.uploadFiles).not.toHaveBeenCalled();
    });

    it('пересобирает записи по одной: следующая склейка ждёт конца предыдущей', async () => {
      // Склейка — copy десятков ГБ по диску, общему с эфиром.
      mockPrisma.recording.findMany.mockResolvedValue([
        { ...failedRow, id: 'rec-1', broadcastId: 'bcast-1' },
        { ...failedRow, id: 'rec-2', broadcastId: 'bcast-2' },
      ]);
      withSources(spyExistsSync, spyReaddirSync);
      let finishFirst!: () => void;
      const build = jest.spyOn(service as any, 'buildAndUpload')
        .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
        .mockResolvedValueOnce(undefined);

      const run = service.retryFailed();
      await flush();
      expect(build).toHaveBeenCalledTimes(1);

      finishFirst();
      await run;
      expect(build).toHaveBeenCalledTimes(2);
      expect(build.mock.calls[1][0]).toBe('rec-2');
    });

    describe('без scratch — полный пайплайн из live/', () => {
      const liveDir = path.join('/recordings', 'live', 'org1/court-a');
      const slotDir = path.join('/recordings', 'archive', 'org1/court-a', 'bcast-resume', 'slot-1');
      const liveSegment = '2026-10-01_10-00-00-000000.mp4';

      beforeEach(() => {
        mockPrisma.recording.findMany.mockResolvedValue([failedRow]);
        mockPrisma.recording.update.mockResolvedValue({});
        spyExistsSync.mockReturnValue(true);
        // scratch пуст, в live/ лежит сегмент.
        spyReaddirSync.mockImplementation((p: any) => (String(p) === liveDir ? [liveSegment] : []) as any);
      });

      it('забирает сегменты из live/, если стрим после этой трансляции в эфир не выходил', async () => {
        await service.retryFailed();

        expect(mockPrisma.broadcast.findFirst).toHaveBeenCalledWith({
          where: { streamId: 'stream-a', startedAt: { gt: failedRow.broadcast.startedAt } },
          select: { id: true },
        });
        expect(mockPrisma.recording.updateMany).toHaveBeenCalledWith({
          where: { id: 'rec-resume', status: 'failed' },
          data: { status: 'processing' },
        });
        expect(spyRenameSync).toHaveBeenCalledWith(
          path.join(liveDir, liveSegment),
          path.join(slotDir, 'seg-0001.mp4'),
        );
      });

      it('не трогает live/, если у стрима есть более поздняя трансляция — сегменты там её', async () => {
        // Иначе пишущийся сейчас сегмент следующего эфира (или его
        // завершённая запись) уехал бы в архив чужой трансляции.
        mockPrisma.broadcast.findFirst.mockResolvedValueOnce({ id: 'bcast-next' });

        await service.retryFailed();

        expect(spyRenameSync).not.toHaveBeenCalled();
        expect(spyMkdirSync).not.toHaveBeenCalled();
        expect(mockPrisma.recording.updateMany).not.toHaveBeenCalled();
        expect(mockS3.uploadFiles).not.toHaveBeenCalled();
      });
    });
  });

  describe('рестарт API посреди конверсии', () => {
    // Конверсия идёт в процессе API; деплой (каждый мерж в main) его
    // перезапускает, и запись оставалась в processing навсегда: retryFailed
    // выбирает только failed.
    // Ответ БД приходит не в той же микрозадаче, а через макрозадачу — как у
    // настоящего запроса. Иначе тест не отличил бы ожидаемый сброс от фонового.
    const processingIds = (ids: string[]) => {
      mockPrisma.recording.findMany.mockImplementation(({ where }: any) =>
        new Promise((resolve) => setImmediate(() =>
          resolve(where.status === 'processing' ? ids.map((id) => ({ id })) : []))));
    };

    it('старт переводит processing прошлого процесса в failed — до того, как API откроет порт', async () => {
      processingIds(['rec-a', 'rec-b']);

      // Nest открывает порт и запускает кроны после onModuleInit всех
      // модулей: сброс обязан завершиться внутри хука, а не фоном.
      await service.onModuleInit();

      expect(mockPrisma.recording.findMany).toHaveBeenCalledWith({
        where: { status: 'processing' },
        select: { id: true },
      });
      expect(mockPrisma.recording.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['rec-a', 'rec-b'] }, status: 'processing' },
        data: { status: 'failed' },
      });
    });

    it('нет processing-записей — ничего не обновляет', async () => {
      processingIds([]);

      await service.onModuleInit();

      expect(mockPrisma.recording.updateMany).not.toHaveBeenCalled();
    });

    it('ошибка БД при сбросе не роняет старт API', async () => {
      mockPrisma.recording.findMany.mockRejectedValueOnce(new Error('connection refused'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(mockPrisma.recording.updateMany).not.toHaveBeenCalled();
    });

    describe('resumeInterrupted', () => {
      const interrupted = {
        id: 'rec-cut',
        broadcastId: 'bcast-cut',
        slotIndex: 1,
        status: 'failed',
        broadcast: {
          streamId: 'stream-a',
          startedAt: new Date('2026-10-01T10:00:00Z'),
          stream: { slug: 'court-a', org: { slug: 'org1' } },
        },
      };
      const liveDir = path.join('/recordings', 'live', 'org1/court-a');
      const slotDir = path.join('/recordings', 'archive', 'org1/court-a', 'bcast-cut', 'slot-1');

      /** Старт сбросил rec-cut; дальше findMany отдаёт её как failed. */
      async function bootWithInterrupted() {
        processingIds(['rec-cut']);
        await service.onModuleInit();
        jest.clearAllMocks();
        mockPrisma.recording.findMany.mockImplementation(({ where }: any) =>
          Promise.resolve(where.status === 'failed' ? [interrupted] : []));
        mockPrisma.recording.update.mockResolvedValue({});
      }

      it('пересобирает из scratch только записи, прерванные рестартом', async () => {
        await bootWithInterrupted();
        spyExistsSync.mockReturnValue(true);
        spyReaddirSync.mockImplementation((p: any) =>
          (String(p) === slotDir ? ['seg-0001.mp4'] : []) as any);

        await service.resumeInterrupted();

        expect(mockPrisma.recording.findMany).toHaveBeenCalledWith(expect.objectContaining({
          where: { status: 'failed', id: { in: ['rec-cut'] } },
        }));
        expect(mockS3.uploadFiles).toHaveBeenCalledWith(
          expect.stringContaining(path.join('archive', 'org1/court-a', 'bcast-cut')),
          expect.arrayContaining(['download.mp4', 'vod.m3u8', 'master.m3u8']),
          'archive/org1/court-a/bcast-cut',
        );
        expect(mockPrisma.recording.update).toHaveBeenCalledWith(expect.objectContaining({
          where: { id: 'rec-cut' },
          data: expect.objectContaining({ status: 'ready' }),
        }));
      });

      it('без scratch в live/ не заглядывает: после деплоя там пишется идущий эфир', async () => {
        await bootWithInterrupted();
        const listed: string[] = [];
        spyExistsSync.mockReturnValue(true);
        spyReaddirSync.mockImplementation((p: any) => {
          listed.push(String(p));
          return (String(p) === liveDir ? ['2026-10-07_12-00-00-000000.mp4'] : []) as any;
        });

        await service.resumeInterrupted();

        expect(listed).not.toContain(liveDir);
        expect(spyRenameSync).not.toHaveBeenCalled();
        expect(mockPrisma.recording.updateMany).not.toHaveBeenCalled();
        expect(mockS3.uploadFiles).not.toHaveBeenCalled();
      });

      it('срабатывает один раз; без прерванных записей не делает ничего', async () => {
        await bootWithInterrupted();
        spyExistsSync.mockReturnValue(true);
        spyReaddirSync.mockImplementation((p: any) =>
          (String(p) === slotDir ? ['seg-0001.mp4'] : []) as any);

        await service.resumeInterrupted();
        mockPrisma.recording.findMany.mockClear();
        await service.resumeInterrupted();

        expect(mockPrisma.recording.findMany).not.toHaveBeenCalled();
      });
    });
  });

  describe('finalizeStaleGlue', () => {
    it('финализирует просроченную паузу: endedAt=pausedAt, отвязка от Stream, onStreamEnded', async () => {
      const pausedAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 часа назад
      mockPrisma.broadcast.findMany.mockResolvedValue([{
        id: 'b1', pausedAt,
        stream: { id: 's1', slug: 'court-a', currentBroadcastId: 'b1', org: { slug: 'club' } },
      }]);
      mockPrisma.broadcast.update.mockResolvedValue({});
      mockPrisma.stream.update.mockResolvedValue({});
      const spyEnd = jest.spyOn(service, 'onStreamEnded').mockResolvedValue(undefined);

      await service.finalizeStaleGlue();

      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { endedAt: pausedAt, pausedAt: null },
      });
      expect(mockPrisma.stream.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { currentBroadcastId: null },
      });
      expect(spyEnd).toHaveBeenCalledWith('b1', 'club/court-a');
    });

    it('запрос выбирает только просроченные паузы (endedAt=null, pausedAt < cutoff)', async () => {
      mockPrisma.broadcast.findMany.mockResolvedValue([]);
      await service.finalizeStaleGlue();
      const where = mockPrisma.broadcast.findMany.mock.calls[0][0].where;
      expect(where.endedAt).toBeNull();
      expect(where.pausedAt).toEqual({ not: null, lt: expect.any(Date) });
    });

    it('чужой currentBroadcastId (Stream уже на другом Broadcast) — указатель не трогается', async () => {
      mockPrisma.broadcast.findMany.mockResolvedValue([{
        id: 'b-old', pausedAt: new Date(0),
        stream: { id: 's1', slug: 'court-a', currentBroadcastId: 'b-new', org: { slug: 'club' } },
      }]);
      mockPrisma.broadcast.update.mockResolvedValue({});
      jest.spyOn(service, 'onStreamEnded').mockResolvedValue(undefined);

      await service.finalizeStaleGlue();

      expect(mockPrisma.stream.update).not.toHaveBeenCalled();
    });
  });

  describe('onModuleInit', () => {
    const archive = (...parts: string[]) => path.join('/recordings/archive', ...parts);

    // Фейковое дерево scratch: путь каталога → его содержимое, подкаталоги — с '/' на конце.
    const mockArchiveTree = (tree: Record<string, string[]>) => {
      spyExistsSync.mockImplementation((p: any) => String(p) in tree);
      spyReaddirSync.mockImplementation((p: any) =>
        (tree[String(p)] ?? []).map((name) => ({
          name: name.replace(/\/$/, ''),
          isDirectory: () => name.endsWith('/'),
        })) as any);
    };

    // Recording есть только у перечисленных broadcastId — как в БД.
    const mockRecordingsFor = (...broadcastIds: string[]) => {
      mockPrisma.recording.findFirst.mockImplementation(({ where }: any) =>
        Promise.resolve(broadcastIds.includes(where.broadcastId)
          ? { id: `rec-${where.broadcastId}`, broadcastId: where.broadcastId }
          : null));
    };

    it('legacy default Stream: keeps a broadcast dir whose recording is still processing', async () => {
      mockArchiveTree({
        [archive()]: ['org1/'],
        [archive('org1')]: ['bcast-processing/'],
        [archive('org1', 'bcast-processing')]: ['slot-1/'],
      });
      mockRecordingsFor('bcast-processing');

      await service.onModuleInit();

      // findFirst must be called WITHOUT a status filter — Karen's fix #1
      expect(mockPrisma.recording.findFirst).toHaveBeenCalledWith({
        where: { broadcastId: 'bcast-processing' },
      });
      expect(spyRmSync).not.toHaveBeenCalled();
    });

    it('legacy default Stream: removes an orphan broadcast dir', async () => {
      mockArchiveTree({
        [archive()]: ['org1/'],
        [archive('org1')]: ['bcast-orphan/'],
        [archive('org1', 'bcast-orphan')]: ['slot-1/', 'master.m3u8'],
      });
      mockRecordingsFor();

      await service.onModuleInit();

      expect(spyRmSync).toHaveBeenCalledTimes(1);
      expect(spyRmSync).toHaveBeenCalledWith(archive('org1', 'bcast-orphan'), { recursive: true, force: true });
    });

    it('named Stream: keeps the stream dir with an in-flight conversion (stream slug is not a broadcastId)', async () => {
      // Регрессия: depth=2 здесь — каталог стрима `h`. Раньше его искали как
      // broadcastId='h', не находили Recording и сносили весь стрим.
      mockArchiveTree({
        [archive()]: ['vegasport/'],
        [archive('vegasport')]: ['h/'],
        [archive('vegasport', 'h')]: ['bcast-live/'],
        [archive('vegasport', 'h', 'bcast-live')]: ['slot-1/'],
      });
      mockRecordingsFor('bcast-live');

      await service.onModuleInit();

      expect(mockPrisma.recording.findFirst).toHaveBeenCalledWith({ where: { broadcastId: 'bcast-live' } });
      expect(mockPrisma.recording.findFirst).not.toHaveBeenCalledWith({ where: { broadcastId: 'h' } });
      expect(spyRmSync).not.toHaveBeenCalled();
    });

    it('named Stream: removes only the orphan broadcast dir, keeps the stream dir and failed scratch for retryFailed', async () => {
      mockArchiveTree({
        [archive()]: ['vegasport/'],
        [archive('vegasport')]: ['h/'],
        [archive('vegasport', 'h')]: ['bcast-failed/', 'bcast-orphan/'],
        [archive('vegasport', 'h', 'bcast-failed')]: ['slot-1/', 'master.m3u8', 'download.mp4'],
        [archive('vegasport', 'h', 'bcast-orphan')]: ['slot-1/'],
      });
      mockRecordingsFor('bcast-failed');

      await service.onModuleInit();

      expect(spyRmSync).toHaveBeenCalledTimes(1);
      expect(spyRmSync).toHaveBeenCalledWith(archive('vegasport', 'h', 'bcast-orphan'), { recursive: true, force: true });
    });

    it('one org with both legacy and named Streams: each orphan is found at its own depth, slot dirs are never candidates', async () => {
      mockArchiveTree({
        [archive()]: ['club/'],
        [archive('club')]: ['bcast-legacy-orphan/', 'bcast-legacy-ok/', 'court-a/'],
        [archive('club', 'bcast-legacy-orphan')]: ['slot-1/'],
        [archive('club', 'bcast-legacy-ok')]: ['slot-1/', 'master.m3u8'],
        [archive('club', 'bcast-legacy-ok', 'slot-1')]: ['seg-0001.mp4', 'index.m3u8'],
        [archive('club', 'court-a')]: ['bcast-named-orphan/', 'bcast-named-ok/'],
        [archive('club', 'court-a', 'bcast-named-orphan')]: ['slot-1/', 'download.mp4'],
        [archive('club', 'court-a', 'bcast-named-ok')]: ['slot-1/'],
      });
      mockRecordingsFor('bcast-legacy-ok', 'bcast-named-ok');

      await service.onModuleInit();

      const removed = spyRmSync.mock.calls.map(([p]) => String(p)).sort();
      expect(removed).toEqual([
        archive('club', 'bcast-legacy-orphan'),
        archive('club', 'court-a', 'bcast-named-orphan'),
      ].sort());
      const looked = mockPrisma.recording.findFirst.mock.calls.map(([arg]: any) => arg.where.broadcastId);
      expect(looked).not.toContain('court-a');
      expect(looked).not.toContain('slot-1');
    });

    it('a stream slugged `slot-1` does not make its org look like a broadcast dir', async () => {
      // Slug `slot-1` проходит валидацию. Классифицируй код каталог org (как
      // сделал бы «упрощённый» рекурсивный обход), org с таким стримом
      // выглядела бы broadcastDir'ом без Recording и снеслась бы целиком.
      mockArchiveTree({
        [archive()]: ['club/'],
        [archive('club')]: ['bcast-legacy/', 'slot-1/'],
        [archive('club', 'bcast-legacy')]: ['slot-1/', 'master.m3u8'],
        [archive('club', 'slot-1')]: ['bcast-named/', 'bcast-named-orphan/'],
        [archive('club', 'slot-1', 'bcast-named')]: ['slot-1/'],
        [archive('club', 'slot-1', 'bcast-named-orphan')]: ['slot-1/'],
      });
      mockRecordingsFor('bcast-legacy', 'bcast-named');

      await service.onModuleInit();

      expect(spyRmSync).toHaveBeenCalledTimes(1);
      expect(spyRmSync).toHaveBeenCalledWith(archive('club', 'slot-1', 'bcast-named-orphan'), { recursive: true, force: true });
      const looked = mockPrisma.recording.findFirst.mock.calls.map(([arg]: any) => arg.where.broadcastId);
      expect(looked).not.toContain('club');
      expect(looked).not.toContain('slot-1');
    });

    it('an unreadable directory does not fail API boot', async () => {
      // org1 не читается целиком; у org2 не читается каталог стрима `h` —
      // это и listSubdirs, и isBroadcastDir.
      const dirent = (name: string) => ({ name, isDirectory: () => true });
      spyExistsSync.mockReturnValue(true);
      spyReaddirSync.mockImplementation((p: any) => {
        if (String(p) === archive()) return [dirent('org1'), dirent('org2')] as any;
        if (String(p) === archive('org2')) return [dirent('h')] as any;
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      });

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(spyRmSync).not.toHaveBeenCalled();
    });
  });

  describe('preview frame (авто-кадр записи)', () => {
    it('convertRecording строит preview.jpg после download.mp4 и до заливки', async () => {
      // настроить существующие спаи convert-пайплайна (probeMp4, buildDownloadMp4,
      // uploadAndFinalize) как в соседних тестах convertRecording
      withSources(spyExistsSync, spyReaddirSync);
      const previewSpy = jest.spyOn(service as any, 'buildPreviewJpeg').mockResolvedValue(undefined);
      await (service as any).convertRecording('rec-1', 'org1/main', 'b1', 1, ['a.mp4'], '/recordings/live/org1/main');
      expect(previewSpy).toHaveBeenCalled();
    });

    it('ошибка кадра НЕ фатальна: uploadAndFinalize всё равно вызывается', async () => {
      withSources(spyExistsSync, spyReaddirSync);
      jest.spyOn(service as any, 'buildPreviewJpeg').mockRejectedValue(new Error('ffmpeg died'));
      const finalizeSpy = jest.spyOn(service as any, 'uploadAndFinalize').mockResolvedValue(undefined);
      await (service as any).convertRecording('rec-1', 'org1/main', 'b1', 1, ['a.mp4'], '/recordings/live/org1/main');
      expect(finalizeSpy).toHaveBeenCalled();
      expect(mockPrisma.recording.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'failed' } }),
      );
    });

    it('uploadAndFinalize ставит Broadcast.previewImagePath если preview.jpg существует', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'rmSync').mockImplementation(() => {});
      mockS3.uploadFiles.mockResolvedValue(undefined);
      mockPrisma.recording.update.mockResolvedValue({});
      mockPrisma.broadcast.update.mockResolvedValue({});
      await (service as any).uploadAndFinalize('rec-1', 'b1', '/scratch/b1', 'archive/org1/main/b1', 100, 60);
      expect(mockPrisma.broadcast.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { previewImagePath: 'archive/org1/main/b1/preview.jpg' },
      });
    });

    it('uploadAndFinalize НЕ трогает Broadcast без preview.jpg', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'rmSync').mockImplementation(() => {});
      mockS3.uploadFiles.mockResolvedValue(undefined);
      mockPrisma.recording.update.mockResolvedValue({});
      await (service as any).uploadAndFinalize('rec-1', 'b1', '/scratch/b1', 'archive/org1/main/b1', 100, 60);
      expect(mockPrisma.broadcast.update).not.toHaveBeenCalled();
    });

    it('buildPreviewJpeg молча выходит, если сегмент не существует', async () => {
      // Глобальный beforeEach подменяет buildPreviewJpeg заглушкой (см. строку
      // ~90), иначе этот тест дергал бы стаб, а не реальный early-return
      // `if (!fs.existsSync(segmentPath)) return;` — восстанавливаем реальную
      // реализацию, чтобы guard был действительно проверен.
      spyBuildPreviewJpeg.mockRestore();
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      await expect((service as any).buildPreviewJpeg('/no/seg.mp4', 10, '/scratch/b1'))
        .resolves.toBeUndefined();
    });
  });

  describe('автоудаление отключено', () => {
    it('у сервиса нет крона, удаляющего записи по сроку', () => {
      expect((service as any).cleanupExpired).toBeUndefined();
    });
  });

  describe('migrateLegacyArchives (перевод старых архивов на байтовые диапазоны)', () => {
    const LEGACY_MASTER =
      '#EXTM3U\n#EXT-X-VERSION:7\n\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1280x720,NAME="slot-1"\n' +
      'slot-1/index.m3u8\n';
    const NEW_MASTER = '#EXTM3U\n#EXT-X-VERSION:7\n\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1280x720\nvod.m3u8\n';

    /** download.mp4 в «S3»: 5 фрагментов по 2 с = 10 с. */
    function s3WithDownload(file = makeFmp4(5)) {
      mockS3.getObjectSize.mockResolvedValue(file.length);
      mockS3.getObjectRange.mockImplementation(async (_k: string, o: number, l: number) => file.subarray(o, o + l));
      return file;
    }

    it('переключает master на vod.m3u8 поверх download.mp4 и удаляет дубль slot-1/', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([
        { id: 'r-old', manifestPath: 'archive/org/s/b1/master.m3u8', duration: 10 },
      ]);
      mockPrisma.recording.update.mockResolvedValue({});
      mockS3.getObjectText.mockResolvedValue(LEGACY_MASTER);
      const file = s3WithDownload();
      const order: string[] = [];
      mockS3.putObject.mockImplementation(async (key: string) => { order.push(`put ${key}`); });
      mockS3.deleteByPrefix.mockImplementation(async (prefix: string) => { order.push(`delete ${prefix}`); });
      mockPrisma.recording.update.mockImplementation(async () => { order.push('db'); });

      await service.migrateLegacyArchives();

      expect(mockS3.getObjectRange.mock.calls[0][0]).toBe('archive/org/s/b1/download.mp4');
      // Сначала новый плейлист, затем master, дубль — после, отметка в БД — последней.
      expect(order).toEqual([
        'put archive/org/s/b1/vod.m3u8',
        'put archive/org/s/b1/master.m3u8',
        'delete archive/org/s/b1/slot-',
        'db',
      ]);
      const vod = String(mockS3.putObject.mock.calls[0][1]);
      expect(vod).toContain('#EXT-X-MAP:URI="download.mp4",BYTERANGE=');
      expect(vod.match(/#EXT-X-BYTERANGE:/g)).toHaveLength(1 + 1); // 5×2 с → куски 6 с + 4 с
      expect(String(mockS3.putObject.mock.calls[1][1])).toBe(NEW_MASTER);
      // expiresAt: null — запись на политике «без срока» и больше не выбирается.
      expect(mockPrisma.recording.update).toHaveBeenCalledWith({
        where: { id: 'r-old' },
        data: { fileSize: file.length, expiresAt: null },
      });
    });

    it('master уже новый (прошлый старт прервался) — без повторной сверки дочищает дубль и отмечает запись', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([
        { id: 'r-half', manifestPath: 'archive/org/s/b2/master.m3u8', duration: 10 },
      ]);
      mockPrisma.recording.update.mockResolvedValue({});
      mockS3.getObjectText.mockResolvedValue(NEW_MASTER);
      s3WithDownload();

      await service.migrateLegacyArchives();

      expect(mockS3.getObjectRange).not.toHaveBeenCalled();
      expect(mockS3.putObject).not.toHaveBeenCalled();
      expect(mockS3.deleteByPrefix).toHaveBeenCalledWith('archive/org/s/b2/slot-');
      expect(mockPrisma.recording.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ expiresAt: null }) }),
      );
    });

    it('download.mp4 короче записи — ничего не переключает и дубль НЕ удаляет', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([
        { id: 'r-cut', manifestPath: 'archive/org/s/b3/master.m3u8', duration: 3600 },
      ]);
      mockS3.getObjectText.mockResolvedValue(LEGACY_MASTER);
      s3WithDownload(); // 10 с против часа

      await service.migrateLegacyArchives();

      expect(mockS3.putObject).not.toHaveBeenCalled();
      expect(mockS3.deleteByPrefix).not.toHaveBeenCalled();
      expect(mockPrisma.recording.update).not.toHaveBeenCalled();
    });

    it('без длительности в БД сверять не с чем — запись не трогается', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([
        { id: 'r-nodur', manifestPath: 'archive/org/s/b4/master.m3u8', duration: null },
      ]);
      mockS3.getObjectText.mockResolvedValue(LEGACY_MASTER);
      s3WithDownload();

      await service.migrateLegacyArchives();

      expect(mockS3.putObject).not.toHaveBeenCalled();
      expect(mockS3.deleteByPrefix).not.toHaveBeenCalled();
    });

    it('ошибка одной записи не останавливает остальные', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([
        { id: 'r-broken', manifestPath: 'archive/org/s/bad/master.m3u8', duration: 10 },
        { id: 'r-ok', manifestPath: 'archive/org/s/ok/master.m3u8', duration: 10 },
      ]);
      mockPrisma.recording.update.mockResolvedValue({});
      mockS3.getObjectText.mockImplementation(async (key: string) => {
        if (key.includes('/bad/')) throw new Error('NoSuchKey');
        return LEGACY_MASTER;
      });
      s3WithDownload();

      await service.migrateLegacyArchives();

      expect(mockS3.deleteByPrefix).toHaveBeenCalledWith('archive/org/s/ok/slot-');
      expect(mockS3.deleteByPrefix).toHaveBeenCalledTimes(1);
    });

    it('выбирает только готовые записи старой политики (с expiresAt) — переведённые не стоят ни запроса', async () => {
      mockPrisma.recording.findMany.mockResolvedValue([]);
      await service.migrateLegacyArchives();
      expect(mockPrisma.recording.findMany).toHaveBeenCalledWith({
        where: { status: 'ready', manifestPath: { not: null }, expiresAt: { not: null } },
        select: { id: true, manifestPath: true, duration: true },
      });
      expect(mockS3.getObjectText).not.toHaveBeenCalled();
    });
  });
});
