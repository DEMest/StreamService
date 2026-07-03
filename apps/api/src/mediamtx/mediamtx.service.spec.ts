import axios from 'axios';
import { MediamtxService } from './mediamtx.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MediamtxService', () => {
  let service: MediamtxService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockResolvedValue({ status: 200 } as any);
    mockedAxios.delete.mockResolvedValue({ status: 200 } as any);
    service = new MediamtxService();
  });

  const postUrls = () => mockedAxios.post.mock.calls.map((c) => c[0] as string);
  const deleteUrls = () => mockedAxios.delete.mock.calls.map((c) => c[0] as string);
  const postBodies = () => mockedAxios.post.mock.calls.map((c) => c[1] as any);

  describe('addStreamPaths', () => {
    it('default Stream: один POST paths/add/live/<orgSlug>', async () => {
      await service.addStreamPaths('club', '', 'secret');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(postUrls()[0]).toMatch(/\/v3\/config\/paths\/add\/live\/club$/);
      expect(postBodies()[0]).toEqual({ srtPublishPassphrase: 'secret' });
    });

    it('named Stream: POST paths/add/live/<org>/<stream>', async () => {
      await service.addStreamPaths('club', 'court-a', 'secret');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(postUrls()[0]).toMatch(/\/v3\/config\/paths\/add\/live\/club\/court-a$/);
    });

    it('400 на add → fallback в replace для того же пути', async () => {
      mockedAxios.post
        .mockRejectedValueOnce({ response: { status: 400 }, message: 'exists' })
        .mockResolvedValueOnce({ status: 200 } as any);
      await service.addStreamPaths('club', '', 'k');
      const urls = postUrls();
      expect(urls[0]).toMatch(/\/paths\/add\/live\/club$/);
      expect(urls[1]).toMatch(/\/paths\/replace\/live\/club$/);
    });
  });

  describe('replaceStreamPaths', () => {
    it('default Stream: один POST paths/replace/live/<orgSlug>', async () => {
      await service.replaceStreamPaths('club', '', 'newkey');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(postUrls()[0]).toMatch(/\/paths\/replace\/live\/club$/);
      expect(postBodies()[0]).toEqual({ srtPublishPassphrase: 'newkey' });
    });

    it('named Stream: POST paths/replace/live/<org>/<stream>', async () => {
      await service.replaceStreamPaths('club', 'tournament', 'newkey');
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(postUrls()[0]).toMatch(/\/paths\/replace\/live\/club\/tournament$/);
    });

    it('record передаётся в теле запроса, когда указан явно', async () => {
      await service.replaceStreamPaths('club', 'foo', 'key', false);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(postUrls()[0]).toMatch(/\/paths\/replace\/live\/club\/foo$/);
      expect(postBodies()[0]).toEqual({ srtPublishPassphrase: 'key', record: false });
    });
  });

  describe('deleteStreamPaths', () => {
    it('default Stream: один DELETE paths/delete/live/<orgSlug>', async () => {
      await service.deleteStreamPaths('club', '');
      expect(mockedAxios.delete).toHaveBeenCalledTimes(1);
      expect(deleteUrls()[0]).toMatch(/\/paths\/delete\/live\/club$/);
    });

    it('named Stream: DELETE paths/delete/live/<org>/<stream>', async () => {
      await service.deleteStreamPaths('club', 'court-a');
      expect(mockedAxios.delete).toHaveBeenCalledTimes(1);
      expect(deleteUrls()[0]).toMatch(/\/paths\/delete\/live\/club\/court-a$/);
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
