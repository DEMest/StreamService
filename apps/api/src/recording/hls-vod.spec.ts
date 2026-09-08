import { buildHlsVodPlaylist, buildMasterPlaylist } from './hls-vod';

describe('buildHlsVodPlaylist', () => {
  it('builds VOD m3u8 from list of fmp4 segments', () => {
    const segments = [
      { filename: 'seg-001.mp4', duration: 10.5 },
      { filename: 'seg-002.mp4', duration: 10.0 },
      { filename: 'seg-003.mp4', duration: 7.3 },
    ];
    const playlist = buildHlsVodPlaylist(segments);
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('#EXT-X-VERSION:7');
    expect(playlist).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(playlist).toContain('#EXT-X-TARGETDURATION:11'); // ceil(max(10.5, 10.0, 7.3))
    expect(playlist).toContain('#EXTINF:10.500,\nseg-001.mp4');
    expect(playlist).toContain('#EXTINF:10.000,\nseg-002.mp4');
    expect(playlist).toContain('#EXTINF:7.300,\nseg-003.mp4');
    expect(playlist).toContain('#EXT-X-ENDLIST');
  });

  it('returns empty manifest if no segments', () => {
    const playlist = buildHlsVodPlaylist([]);
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).toContain('#EXT-X-TARGETDURATION:0');
    expect(playlist).toContain('#EXT-X-ENDLIST');
  });
});

describe('buildMasterPlaylist', () => {
  it('builds master playlist with the single variant', () => {
    const master = buildMasterPlaylist({ slotIndex: 1, bandwidth: 5_000_000, resolution: '1920x1080' });
    expect(master).toContain('#EXTM3U');
    expect(master).toContain('#EXT-X-VERSION:7');
    expect(master).toContain('#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="slot-1"');
    expect(master).toContain('slot-1/index.m3u8');
  });

  // Байт-в-байт тот же manifest, что лежит в уже залитых архивах: они не
  // перегенерируются, поэтому сменить здесь хоть перевод строки нельзя.
  it('keeps the exact manifest bytes of already uploaded archives', () => {
    expect(buildMasterPlaylist({ slotIndex: 1, bandwidth: 5_000_000, resolution: '1920x1080' })).toBe(
      '#EXTM3U\n#EXT-X-VERSION:7\n\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="slot-1"\n' +
        'slot-1/index.m3u8\n',
    );
  });

  // slotIndex приходит из Recording.slotIndex (retryFailed берёт его из БД) —
  // master обязан указывать на тот каталог, куда легли сегменты.
  it('follows slotIndex into the variant path', () => {
    const master = buildMasterPlaylist({ slotIndex: 2, bandwidth: 5_000_000, resolution: '1920x1080' });
    expect(master).toContain('NAME="slot-2"');
    expect(master).toContain('slot-2/index.m3u8');
    expect(master).not.toContain('slot-1');
  });
});
