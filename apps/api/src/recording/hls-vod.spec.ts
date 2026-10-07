import {
  buildByteRangeVodPlaylist,
  buildMasterPlaylist,
  groupFragments,
  legacySlotDir,
  VOD_CHUNK_TARGET_SECONDS,
} from './hls-vod';

const frag = (offset: number, length: number, duration: number) => ({ offset, length, duration });

describe('groupFragments', () => {
  it('склеивает смежные короткие фрагменты в куски не короче цели', () => {
    // секундный GOP: 13 фрагментов по 1 с → куски 6 + 6 + 1
    const fragments = Array.from({ length: 13 }, (_, i) => frag(100 + i * 10, 10, 1));
    const chunks = groupFragments(fragments, 6);
    expect(chunks.map((c) => c.duration)).toEqual([6, 6, 1]);
    expect(chunks[0]).toEqual({ offset: 100, length: 60, duration: 6 });
    expect(chunks[1]).toEqual({ offset: 160, length: 60, duration: 6 });
  });

  it('длинный GOP остаётся отдельным куском — внутри GOP без перекодирования не режется', () => {
    const chunks = groupFragments([frag(0, 5, 9.5), frag(5, 5, 8.3)], VOD_CHUNK_TARGET_SECONDS);
    expect(chunks).toHaveLength(2);
  });

  it('не склеивает фрагменты, между которыми есть посторонние байты', () => {
    const chunks = groupFragments([frag(0, 10, 1), frag(20, 10, 1)], 6);
    expect(chunks).toHaveLength(2);
  });

  it('не мутирует входные фрагменты', () => {
    const fragments = [frag(0, 10, 1), frag(10, 10, 1)];
    groupFragments(fragments, 6);
    expect(fragments[0]).toEqual(frag(0, 10, 1));
  });
});

describe('buildByteRangeVodPlaylist', () => {
  it('строит VOD-плейлист из байтовых диапазонов одного файла', () => {
    const playlist = buildByteRangeVodPlaylist('download.mp4', 1296, [
      { offset: 1296, length: 4363757, duration: 9.452 },
      { offset: 4365053, length: 4340245, duration: 8.333 },
    ]);
    expect(playlist).toBe([
      '#EXTM3U',
      '#EXT-X-VERSION:7',
      '#EXT-X-TARGETDURATION:10',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-INDEPENDENT-SEGMENTS',
      '#EXT-X-MAP:URI="download.mp4",BYTERANGE="1296@0"',
      '#EXTINF:9.452,',
      '#EXT-X-BYTERANGE:4363757@1296',
      'download.mp4',
      '#EXTINF:8.333,',
      '#EXT-X-BYTERANGE:4340245@4365053',
      'download.mp4',
      '#EXT-X-ENDLIST',
      '',
    ].join('\n'));
  });

  it('смещения за пределами 32 бит (многочасовая запись) пишутся как есть', () => {
    const playlist = buildByteRangeVodPlaylist('download.mp4', 1296, [
      { offset: 14_852_287_190, length: 4_284_552, duration: 8.033 },
    ]);
    expect(playlist).toContain('#EXT-X-BYTERANGE:4284552@14852287190');
  });
});

describe('buildMasterPlaylist', () => {
  it('единственный variant указывает на переданный медиаплейлист', () => {
    expect(buildMasterPlaylist({ uri: 'vod.m3u8', bandwidth: 5_000_000, resolution: '1920x1080' })).toBe(
      '#EXTM3U\n#EXT-X-VERSION:7\n\n' +
        '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\n' +
        'vod.m3u8\n',
    );
  });
});

describe('legacySlotDir', () => {
  it('узнаёт master старого формата (variant поверх slot-N/)', () => {
    const legacy =
      '#EXTM3U\n#EXT-X-VERSION:7\n\n' +
      '#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,NAME="slot-1"\n' +
      'slot-1/index.m3u8\n';
    expect(legacySlotDir(legacy)).toBe('slot-1');
  });

  it('новый master — не legacy', () => {
    expect(legacySlotDir(buildMasterPlaylist({ uri: 'vod.m3u8', bandwidth: 1, resolution: '1x1' }))).toBeNull();
  });
});
