import { parseFfmpegProgress } from './ffmpeg-progress';

const block = (n: number, opts: Partial<Record<string, string>> = {}) => [
  `frame=${n * 30}`,
  `fps=${opts.fps ?? '30.00'}`,
  'stream_0_0_q=-1.0',
  `bitrate=${opts.bitrate ?? '6000.5kbits/s'}`,
  'total_size=123456',
  `out_time_us=${n * 1_000_000}`,
  `out_time_ms=${n * 1_000_000}`,
  'out_time=00:00:01.000000',
  `dup_frames=${opts.dup ?? '0'}`,
  `drop_frames=${opts.drop ?? '0'}`,
  `speed=${opts.speed ?? '1.01x'}`,
  `progress=${opts.progress ?? 'continue'}`,
].join('\n');

describe('parseFfmpegProgress', () => {
  it('возвращает null, когда закрытого блока ещё нет', () => {
    expect(parseFfmpegProgress('')).toBeNull();
    expect(parseFfmpegProgress('frame=10\nfps=30.00\n')).toBeNull();
  });

  it('разбирает полный блок', () => {
    const r = parseFfmpegProgress(block(1))!;
    expect(r.frame).toBe(30);
    expect(r.fps).toBe(30);
    expect(r.outKbps).toBe(6000.5);
    expect(r.dropFrames).toBe(0);
    expect(r.speed).toBe(1.01);
    expect(r.outTimeSeconds).toBe(1);
    expect(r.ended).toBe(false);
  });

  it('берёт ПОСЛЕДНИЙ блок, а не первый', () => {
    const tail = [block(1), block(2, { drop: '17', speed: '0.85x' })].join('\n');
    const r = parseFfmpegProgress(tail)!;
    expect(r.dropFrames).toBe(17);
    expect(r.speed).toBe(0.85);
    expect(r.frame).toBe(60);
  });

  it('игнорирует недописанный блок в самом конце', () => {
    // Так выглядит реальный хвост: FFmpeg как раз пишет следующий блок.
    const tail = [block(1, { drop: '3' }), 'frame=90\nfps=29.50\n'].join('\n');
    const r = parseFfmpegProgress(tail)!;
    expect(r.dropFrames).toBe(3);
    expect(r.frame).toBe(30);
  });

  it('переживает обрезанный первый блок (читаем окно с конца файла)', () => {
    const tail = ['ate=5000.0kbits/s', 'speed=0.9x', 'progress=continue', block(5)].join('\n');
    const r = parseFfmpegProgress(tail)!;
    // Взят второй, целый блок.
    expect(r.speed).toBe(1.01);
    expect(r.frame).toBe(150);
  });

  it('отдаёт null по полям, которые FFmpeg ещё пишет как N/A', () => {
    const r = parseFfmpegProgress(block(1, { speed: 'N/A', bitrate: 'N/A' }))!;
    expect(r.speed).toBeNull();
    expect(r.outKbps).toBeNull();
    // Остальное при этом разобрано.
    expect(r.frame).toBe(30);
  });

  it('распознаёт штатное завершение', () => {
    expect(parseFfmpegProgress(block(9, { progress: 'end' }))!.ended).toBe(true);
  });
});
