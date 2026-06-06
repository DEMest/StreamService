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
  it('builds master playlist with slot variants', () => {
    const master = buildMasterPlaylist([
      { slotIndex: 1, bandwidth: 5_000_000, resolution: '1920x1080' },
    ]);
    expect(master).toContain('#EXTM3U');
    expect(master).toContain('#EXT-X-VERSION:7');
    expect(master).toContain('#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="slot-1"');
    expect(master).toContain('slot-1/index.m3u8');
  });
});
