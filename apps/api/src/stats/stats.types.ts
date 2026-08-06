/** Одна точка на графике. Поля намеренно короткие — их уезжают сотни в JSON. */
export interface StatsSample {
  /** unix ms */
  t: number;
  /** Входящий битрейт от пушера, кбит/с. */
  inKbps: number;
  /** Исходящий битрейт ко всем читателям, кбит/с. */
  outKbps: number;
  /** fps транскода; null — пока FFmpeg не отдал progress. */
  fps: number | null;
  /** 1.0 = realtime. Ниже — сервер не успевает. */
  speed: number | null;
  /** Кадров выброшено ЗА ЭТОТ интервал (не накопительно — так видно всплеск). */
  dropped: number | null;
}

export interface StreamStatsSnapshot {
  /** MediaMTX-путь, по которому собрана статистика. */
  path: string;
  /**
   * Удалось ли вообще получить состояние от медиасервера. false — данные
   * неизвестны; показывать в этом случае «офлайн» нельзя, эфир может идти.
   */
  connected: boolean;
  live: boolean;
  /** Секунд с начала публикации; null — не в эфире. */
  uptimeSeconds: number | null;

  source: {
    /** 'rtmpConn' | 'srtConn' | 'rtspSession' | … — как отдаёт MediaMTX. */
    protocol: string;
    remoteAddr: string | null;
    connectedAt: string | null;
  } | null;

  video: {
    codec: string;
    width: number | null;
    height: number | null;
    profile: string | null;
    level: string | null;
  } | null;

  audio: {
    codec: string;
    sampleRate: number | null;
    channels: number | null;
  } | null;

  ingest: {
    kbps: number;
    bytesReceived: number;
    /** Битые кадры на входе — растёт при проблемах канала пушера. */
    framesInError: number;
  };

  /** Состояние HLS-транскодера. null — progress-файла ещё нет. */
  transcode: {
    fps: number | null;
    speed: number | null;
    outKbps: number | null;
    droppedFramesTotal: number | null;
    dupFramesTotal: number | null;
    /** false — speed заметно ниже 1.0 либо кадры сыплются: зритель это увидит. */
    healthy: boolean;
  } | null;

  /** Только для SRT-пушей; у RTMP таких данных нет в принципе. */
  srt: {
    packetsReceived: number | null;
    packetsLost: number | null;
    packetsDropped: number | null;
    rttMs: number | null;
  } | null;

  /** Внутренние читатели MediaMTX (наш HLS-FFmpeg и т.п.). */
  readers: number;
  /** Уникальные зрители HLS за последнюю минуту. */
  viewers: number;

  /** Точки за последние ~10 минут, старые первыми. */
  history: StatsSample[];
}
