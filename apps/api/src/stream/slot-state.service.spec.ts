import { SlotStateService, SlotState } from './slot-state.service';

describe('SlotStateService', () => {
  let service: SlotStateService;

  beforeEach(() => {
    service = new SlotStateService();
  });

  describe('setPublishing', () => {
    it('updates state to publishing=true and emits slotState event with new value', () => {
      const received: SlotState[] = [];
      service.on((s) => received.push(s));

      const result = service.setPublishing('stream-1', 2, true);

      expect(result.streamId).toBe('stream-1');
      expect(result.slotIndex).toBe(2);
      expect(result.isPublishing).toBe(true);
      expect(result.lastPublishAt).toBeInstanceOf(Date);
      expect(result.lastUnpublishAt).toBeNull();

      expect(received).toHaveLength(1);
      expect(received[0].isPublishing).toBe(true);
      expect(received[0].streamId).toBe('stream-1');
      expect(received[0].slotIndex).toBe(2);
    });

    it('updates publishing=false and resets bitrate, sets lastUnpublishAt', () => {
      service.setPublishing('stream-1', 1, true);
      service.setBitrate('stream-1', 1, 5_000_000);

      const received: SlotState[] = [];
      service.on((s) => received.push(s));

      const result = service.setPublishing('stream-1', 1, false);

      expect(result.isPublishing).toBe(false);
      expect(result.bitrate).toBeNull();
      expect(result.lastUnpublishAt).toBeInstanceOf(Date);
      expect(result.lastPublishAt).toBeInstanceOf(Date);

      // последний event соответствует setPublishing(false)
      expect(received[received.length - 1].isPublishing).toBe(false);
      expect(received[received.length - 1].bitrate).toBeNull();
    });

    it('persists state across calls (getStreamState reflects updates)', () => {
      service.setPublishing('stream-1', 1, true);
      service.setPublishing('stream-1', 2, true);
      service.setPublishing('stream-1', 2, false);

      const states = service.getStreamState('stream-1');
      expect(states).toHaveLength(2);
      expect(states.find((s) => s.slotIndex === 1)?.isPublishing).toBe(true);
      expect(states.find((s) => s.slotIndex === 2)?.isPublishing).toBe(false);
    });
  });

  describe('setBitrate', () => {
    it('updates bitrate and emits slotState event', () => {
      service.setPublishing('s1', 1, true);

      const received: SlotState[] = [];
      service.on((s) => received.push(s));

      const result = service.setBitrate('s1', 1, 4_500_000);

      expect(result.bitrate).toBe(4_500_000);
      expect(received).toHaveLength(1);
      expect(received[0].bitrate).toBe(4_500_000);
    });
  });

  describe('getActiveSlotIndexes', () => {
    it('returns only slots with isPublishing=true, sorted by slotIndex', () => {
      service.setPublishing('stream-A', 1, true);
      service.setPublishing('stream-A', 2, false);
      service.setPublishing('stream-A', 3, true);
      service.setPublishing('stream-A', 4, true);
      // другой Stream — не должен попасть в выборку
      service.setPublishing('stream-B', 1, true);

      const active = service.getActiveSlotIndexes('stream-A');

      expect(active).toEqual([1, 3, 4]);
    });

    it('returns empty array if no slots are publishing', () => {
      service.setPublishing('s1', 1, false);
      expect(service.getActiveSlotIndexes('s1')).toEqual([]);
    });

    it('returns empty array for unknown stream', () => {
      expect(service.getActiveSlotIndexes('unknown')).toEqual([]);
    });
  });

  describe('getStreamState', () => {
    it('returns snapshot copies (mutating result does not affect store)', () => {
      service.setPublishing('s1', 1, true);
      const snap = service.getStreamState('s1');
      snap[0].isPublishing = false;
      expect(service.getStreamState('s1')[0].isPublishing).toBe(true);
    });
  });

  describe('clearStream', () => {
    it('removes all slot states for a stream', () => {
      service.setPublishing('s1', 1, true);
      service.setPublishing('s1', 2, true);
      service.setPublishing('s2', 1, true);

      service.clearStream('s1');

      expect(service.getStreamState('s1')).toEqual([]);
      expect(service.getStreamState('s2')).toHaveLength(1);
    });
  });

  describe('onModuleInit (reconcile)', () => {
    it('запускает setPublishing для каждого ready=true пути из MediaMTX', async () => {
      const mediamtx = {
        listActivePublishers: jest.fn().mockResolvedValue([
          { name: 'live/orgA/1', ready: true },
          { name: 'live/orgA/2', ready: true },
          { name: 'live/orgB', ready: true },
          { name: 'live/orgC', ready: false }, // не ready — игнор
        ]),
      };
      const resolved = new Map<string, any>([
        ['live/orgA/1', { stream: { id: 'sA' }, slotIndex: 1 }],
        ['live/orgA/2', { stream: { id: 'sA' }, slotIndex: 2 }],
        ['live/orgB', { stream: { id: 'sB' }, slotIndex: null }],
      ]);
      const streams = {
        resolvePathToStream: jest.fn(async (p: string) => resolved.get(p) ?? null),
      };

      const svc = new SlotStateService(mediamtx as any, streams as any);
      await svc.onModuleInit();

      // sA — два активных slot'а
      expect(svc.getActiveSlotIndexes('sA')).toEqual([1, 2]);
      // sB — composite (slotIndex=null → effectiveSlot=1)
      expect(svc.getActiveSlotIndexes('sB')).toEqual([1]);
      // orgC не ready → не должно появиться
      expect(svc.getActiveSlotIndexes('sC')).toEqual([]);
    });

    it('игнорирует пути не резолвящиеся в Stream (legacy/чужие)', async () => {
      const mediamtx = {
        listActivePublishers: jest.fn().mockResolvedValue([
          { name: 'live/ghost', ready: true },
          { name: 'live/orgA', ready: true },
        ]),
      };
      const streams = {
        resolvePathToStream: jest.fn(async (p: string) =>
          p === 'live/orgA' ? { stream: { id: 'sA' }, slotIndex: null } : null,
        ),
      };

      const svc = new SlotStateService(mediamtx as any, streams as any);
      await svc.onModuleInit();

      expect(svc.getActiveSlotIndexes('sA')).toEqual([1]);
      expect(streams.resolvePathToStream).toHaveBeenCalledTimes(2);
    });

    it('не падает если MediaMTX недоступен на старте', async () => {
      const mediamtx = {
        listActivePublishers: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      };
      const streams = { resolvePathToStream: jest.fn() };

      const svc = new SlotStateService(mediamtx as any, streams as any);
      await expect(svc.onModuleInit()).resolves.toBeUndefined();
      expect(streams.resolvePathToStream).not.toHaveBeenCalled();
    });

    it('skip если зависимости не инжектированы (тестовый инстанс)', async () => {
      const svc = new SlotStateService();
      await expect(svc.onModuleInit()).resolves.toBeUndefined();
    });
  });
});
