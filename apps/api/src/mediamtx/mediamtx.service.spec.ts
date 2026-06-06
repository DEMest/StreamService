import axios from 'axios';
import { MediamtxService } from './mediamtx.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MediamtxService', () => {
  let service: MediamtxService;

  // URL базы хранится из env при инстанцировании; для тестов это не важно — проверяем суффикс пути.
  const expectPostAdd = (path: string, passphrase: string) =>
    expect.objectContaining({});

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ status: 200 } as any);
    mockedAxios.delete.mockResolvedValue({ status: 200 } as any);
    service = new MediamtxService();
  });

  // Хелперы для извлечения URL'ов из вызовов
  const postUrls = () => mockedAxios.post.mock.calls.map((c) => c[0] as string);
  const deleteUrls = () => mockedAxios.delete.mock.calls.map((c) => c[0] as string);
  const postBodies = () => mockedAxios.post.mock.calls.map((c) => c[1] as any);

  describe('pathsForStream', () => {
    it('composite default Stream → [<orgSlug>]', () => {
      expect(service.pathsForStream('club', '', 'composite', 1)).toEqual(['club']);
    });

    it('composite named Stream → [<orgSlug>/<streamSlug>]', () => {
      expect(service.pathsForStream('club', 'court-a', 'composite', 1)).toEqual(['club/court-a']);
    });

    it('multistream default Stream → [<orgSlug>/1..N]', () => {
      expect(service.pathsForStream('club', '', 'multistream', 3)).toEqual([
        'club/1', 'club/2', 'club/3',
      ]);
    });

    it('multistream named Stream → [<orgSlug>/<streamSlug>/1..N]', () => {
      expect(service.pathsForStream('club', 'tournament', 'multistream', 2)).toEqual([
        'club/tournament/1', 'club/tournament/2',
      ]);
    });
  });

  describe('addStreamPaths', () => {
    it('composite/slotCount=1: один POST paths/add/live/<slug>', async () => {
      await service.addStreamPaths('club', '', 'composite', 1, 'secret');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(postUrls()[0]).toMatch(/\/v3\/config\/paths\/add\/live\/club$/);
      expect(postBodies()[0]).toEqual({ srtPublishPassphrase: 'secret' });
    });

    it('composite named Stream: POST paths/add/live/<org>/<stream>', async () => {
      await service.addStreamPaths('club', 'court-a', 'composite', 1, 'secret');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(postUrls()[0]).toMatch(/\/v3\/config\/paths\/add\/live\/club\/court-a$/);
    });

    it('multistream/slotCount=3: три POST с одним passphrase', async () => {
      await service.addStreamPaths('club', '', 'multistream', 3, 'shared-key');
      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
      const urls = postUrls().sort();
      expect(urls[0]).toMatch(/\/v3\/config\/paths\/add\/live\/club\/1$/);
      expect(urls[1]).toMatch(/\/v3\/config\/paths\/add\/live\/club\/2$/);
      expect(urls[2]).toMatch(/\/v3\/config\/paths\/add\/live\/club\/3$/);
      // Все три тела одинаковые
      for (const body of postBodies()) {
        expect(body).toEqual({ srtPublishPassphrase: 'shared-key' });
      }
    });

    it('multistream named Stream: пути включают streamSlug', async () => {
      await service.addStreamPaths('club', 'tournament', 'multistream', 2, 'k');
      const urls = postUrls().sort();
      expect(urls[0]).toMatch(/\/paths\/add\/live\/club\/tournament\/1$/);
      expect(urls[1]).toMatch(/\/paths\/add\/live\/club\/tournament\/2$/);
    });

    it('400 на add → fallback в replace для того же пути', async () => {
      mockedAxios.post
        .mockRejectedValueOnce({ response: { status: 400 }, message: 'exists' })
        .mockResolvedValueOnce({ status: 200 } as any);
      await service.addStreamPaths('club', '', 'composite', 1, 'k');
      // первый POST — add, второй (fallback) — replace
      const urls = postUrls();
      expect(urls[0]).toMatch(/\/paths\/add\/live\/club$/);
      expect(urls[1]).toMatch(/\/paths\/replace\/live\/club$/);
    });
  });

  describe('replaceStreamPaths', () => {
    it('composite: один POST paths/replace/live/<slug>', async () => {
      await service.replaceStreamPaths('club', '', 'composite', 1, 'newkey');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(postUrls()[0]).toMatch(/\/paths\/replace\/live\/club$/);
      expect(postBodies()[0]).toEqual({ srtPublishPassphrase: 'newkey' });
    });

    it('multistream/slotCount=4: четыре POST paths/replace с новым ключом', async () => {
      await service.replaceStreamPaths('club', '', 'multistream', 4, 'newkey');
      expect(mockedAxios.post).toHaveBeenCalledTimes(4);
      for (const url of postUrls()) {
        expect(url).toMatch(/\/paths\/replace\/live\/club\/[1-4]$/);
      }
      for (const body of postBodies()) {
        expect(body).toEqual({ srtPublishPassphrase: 'newkey' });
      }
    });
  });

  describe('deleteStreamPaths', () => {
    it('composite: один DELETE paths/delete/live/<slug>', async () => {
      await service.deleteStreamPaths('club', '', 'composite', 1);
      expect(mockedAxios.delete).toHaveBeenCalledTimes(1);
      expect(deleteUrls()[0]).toMatch(/\/paths\/delete\/live\/club$/);
    });

    it('multistream/slotCount=3: три DELETE', async () => {
      await service.deleteStreamPaths('club', '', 'multistream', 3);
      expect(mockedAxios.delete).toHaveBeenCalledTimes(3);
      const urls = deleteUrls().sort();
      expect(urls[0]).toMatch(/\/paths\/delete\/live\/club\/1$/);
      expect(urls[1]).toMatch(/\/paths\/delete\/live\/club\/2$/);
      expect(urls[2]).toMatch(/\/paths\/delete\/live\/club\/3$/);
    });
  });

  describe('updateStreamPaths', () => {
    it('composite→multistream (1→4): один DELETE старого + 4 ADD новых', async () => {
      await service.updateStreamPaths('club', '', 'composite', 'multistream', 1, 4, 'k');
      // DELETE: 'club' (старый composite-путь)
      expect(mockedAxios.delete).toHaveBeenCalledTimes(1);
      expect(deleteUrls()[0]).toMatch(/\/paths\/delete\/live\/club$/);
      // ADD: club/1..4
      expect(mockedAxios.post).toHaveBeenCalledTimes(4);
      const addUrls = postUrls().sort();
      expect(addUrls[0]).toMatch(/\/paths\/add\/live\/club\/1$/);
      expect(addUrls[1]).toMatch(/\/paths\/add\/live\/club\/2$/);
      expect(addUrls[2]).toMatch(/\/paths\/add\/live\/club\/3$/);
      expect(addUrls[3]).toMatch(/\/paths\/add\/live\/club\/4$/);
    });

    it('multistream→composite (3→1): 3 DELETE + 1 ADD', async () => {
      await service.updateStreamPaths('club', '', 'multistream', 'composite', 3, 1, 'k');
      expect(mockedAxios.delete).toHaveBeenCalledTimes(3);
      const delUrls = deleteUrls().sort();
      expect(delUrls[0]).toMatch(/\/paths\/delete\/live\/club\/1$/);
      expect(delUrls[1]).toMatch(/\/paths\/delete\/live\/club\/2$/);
      expect(delUrls[2]).toMatch(/\/paths\/delete\/live\/club\/3$/);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(postUrls()[0]).toMatch(/\/paths\/add\/live\/club$/);
    });

    it('multistream 2→4: 2 ADD (только n=3,4), без трогания n=1,2', async () => {
      await service.updateStreamPaths('club', '', 'multistream', 'multistream', 2, 4, 'k');
      expect(mockedAxios.delete).not.toHaveBeenCalled();
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      const addUrls = postUrls().sort();
      expect(addUrls[0]).toMatch(/\/paths\/add\/live\/club\/3$/);
      expect(addUrls[1]).toMatch(/\/paths\/add\/live\/club\/4$/);
    });

    it('multistream 4→2: 2 DELETE (n=3,4), без трогания n=1,2', async () => {
      await service.updateStreamPaths('club', '', 'multistream', 'multistream', 4, 2, 'k');
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(mockedAxios.delete).toHaveBeenCalledTimes(2);
      const delUrls = deleteUrls().sort();
      expect(delUrls[0]).toMatch(/\/paths\/delete\/live\/club\/3$/);
      expect(delUrls[1]).toMatch(/\/paths\/delete\/live\/club\/4$/);
    });

    it('no-op (composite 1→1): ни ADD, ни DELETE', async () => {
      await service.updateStreamPaths('club', '', 'composite', 'composite', 1, 1, 'k');
      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(mockedAxios.delete).not.toHaveBeenCalled();
    });

    it('named Stream multistream 1→3: ADD только новых n=2,3', async () => {
      await service.updateStreamPaths('club', 'court-a', 'multistream', 'multistream', 1, 3, 'k');
      expect(mockedAxios.delete).not.toHaveBeenCalled();
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      const addUrls = postUrls().sort();
      expect(addUrls[0]).toMatch(/\/paths\/add\/live\/club\/court-a\/2$/);
      expect(addUrls[1]).toMatch(/\/paths\/add\/live\/club\/court-a\/3$/);
    });
  });

  describe('deprecated wrappers', () => {
    it('addPath делегирует в один add-POST', async () => {
      await service.addPath('legacy-path', 'k');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(postUrls()[0]).toMatch(/\/paths\/add\/live\/legacy-path$/);
    });

    it('patchPath делегирует в replace-POST', async () => {
      await service.patchPath('legacy-path', 'k');
      expect(postUrls()[0]).toMatch(/\/paths\/replace\/live\/legacy-path$/);
    });

    it('deletePath делегирует в DELETE', async () => {
      await service.deletePath('legacy-path');
      expect(deleteUrls()[0]).toMatch(/\/paths\/delete\/live\/legacy-path$/);
    });
  });
});
