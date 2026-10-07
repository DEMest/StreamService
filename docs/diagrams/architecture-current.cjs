'use strict';

// Текущая архитектура StreamService (as-is). Координаты — сетка viewBox
// 2110×1100; слева направо: кодер → медиа-тракт → API/Web → edge-nginx →
// браузеры; нижняя полоса — разработка и выкатка, под хостом — внешние сервисы.

function build(L) {
  const W = 2110;
  const H = 1100;
  const b = [];

  b.push(
    L.legend({
      x: 1440,
      y: 40,
      items: [
        { type: 'solid', label: 'медиа и данные' },
        { type: 'dashed', label: 'управление и сигналы' },
        { type: 'dashbox', label: 'один физический сервер' },
      ],
    }),
  );

  // ── Граница хоста ────────────────────────────────────────────────────────
  b.push(
    L.group({
      x: 330,
      y: 100,
      w: 1400,
      h: 800,
      label: 'Один сервер (VPS) · Docker Compose: postgres, minio, mediamtx, api, web · отдельный стек edge-nginx · self-hosted CI-runner',
    }),
  );

  // ── Кодер ────────────────────────────────────────────────────────────────
  b.push(
    L.box({
      x: 30, y: 170, w: 250, h: 175, kind: 'media',
      title: 'Кодер организации',
      lines: [
        'vMix / OBS на площадке',
        'один поток на Stream:',
        'композит 2×2 (feedMode =',
        'composite) или один ракурс',
        'SRT passphrase / RTMP-ключ',
        "= ingestKey Stream'а",
        '1080p/4K, ~6 Мбит/с',
      ],
    }),
  );

  // ── Медиа-тракт ──────────────────────────────────────────────────────────
  b.push(
    L.box({
      x: 380, y: 150, w: 260, h: 160, kind: 'media',
      title: 'MediaMTX (контейнер)',
      lines: [
        'SRT :8890/udp · RTMP :1935',
        'authMethod: http → API',
        'SRT: passphrase на транспорте',
        'hls: false — свой муксер выключен',
        "record: fmp4 по пути Stream'а",
        'runOnReady / NotReady → скрипты',
      ],
    }),
    L.box({
      x: 420, y: 360, w: 220, h: 160, kind: 'media',
      title: 'FFmpeg (on-ready.sh)',
      lines: [
        'вход: RTSP :8554 (localhost)',
        'hd/: video copy, audio → AAC',
        'p720/p480/p240: libx264',
        '(HLS_LQ_ENABLED=true)',
        'сегменты 2 с, окно 40',
        'один процесс на Stream',
      ],
    }),
    L.store({
      x: 700, y: 380, w: 180, h: 80,
      title: 'том hls_data',
      lines: ['/hls/<path>/', 'master.m3u8, hd/, p720/…'],
    }),
    L.store({
      x: 700, y: 560, w: 180, h: 80,
      title: 'том recordings_data',
      lines: ['/recordings/<path>/', 'fmp4-сегменты по 3 ч'],
    }),
  );

  // ── Приложение ───────────────────────────────────────────────────────────
  b.push(
    L.box({
      x: 930, y: 150, w: 270, h: 510, kind: 'app',
      title: 'API — NestJS 10 (Node 20)',
      lines: [
        'REST /v1 · JWT в cookie · 3 роли',
        'org / stream / public / admin / ads',
        'мультиарендность: чужое → 404',
        'WS /chat: комната на Stream,',
        'счётчик зрителей = онлайн',
        'SEO: правила индексации, пинг',
        'ёмкость: лог nginx + QoE + FFmpeg',
        'почта (SMTP), тревоги в Telegram',
      ],
      sections: [
        {
          y: 380,
          title: 'Live HLS',
          lines: ['отдаёт /hls/live/… с диска', 'previewKey для приватных', 'Cache-Control: no-store'],
        },
        {
          y: 520,
          title: 'Архив (recording/)',
          lines: [
            'ffmpeg -c copy → download.mp4,',
            'VOD = байт-диапазоны → S3',
            '302 → presigned URL зрителю',
            'хранение без срока;',
            'retry 03:30, glue каждые 5 мин',
          ],
        },
      ],
    }),
    L.box({
      x: 1290, y: 150, w: 180, h: 160, kind: 'app',
      title: 'Web — Next.js 14',
      lines: [
        'App Router, SSR',
        'middleware: роли по JWT',
        'rewrite /api/* → api:3001',
        'React Query, Tailwind',
        'hls.js + <canvas>-плеер',
        'robots / sitemap — route',
      ],
    }),
    L.store({
      x: 1290, y: 370, w: 180, h: 95,
      title: 'PostgreSQL 16',
      lines: ['Prisma · 12 моделей', 'Organization → Stream →', 'Broadcast → Recording'],
    }),
    L.store({
      x: 1290, y: 485, w: 180, h: 60,
      title: 'том nginx_logs',
      lines: ['capacity.log'],
    }),
    L.store({
      x: 1290, y: 565, w: 180, h: 95,
      title: 'MinIO / S3-хранилище',
      lines: ['архив: MP4 + плейлисты,', 'превью; картинки орг.', 'presigned, /static/'],
    }),
  );

  // ── Граница сети ─────────────────────────────────────────────────────────
  b.push(
    L.box({
      x: 1540, y: 150, w: 150, h: 510, kind: 'edge',
      title: 'edge-nginx',
      lines: [
        "TLS, Let's Encrypt",
        '',
        'кэш HLS-сегментов:',
        '.ts — 5 с',
        '.m3u8 — 1 с',
        'stale при ошибке',
        'апстрима',
        '',
        'limit_req /',
        'limit_conn',
        '',
        'хосты:',
        'liga-live.ru',
        'admin., ads., bot.',
        '',
        'пишет capacity.log',
        '(на проде ещё',
        'не включён)',
      ],
    }),
  );

  // ── Клиенты ──────────────────────────────────────────────────────────────
  b.push(
    L.box({
      x: 1810, y: 150, w: 270, h: 250, kind: 'edge',
      title: 'Зритель — браузер',
      lines: [
        'hls.js → скрытый <video> →',
        '<canvas>: весь кадр или квадрант',
        '2×2 (cam1–cam4) — кроп на клиенте',
        'ABR: hd · 720p · 480p · 240p',
        'Socket.io: чат (ник в localStorage)',
        'QoE-телеметрия → API',
        'iOS: нативный HLS; fullscreen',
        'через captureStream',
      ],
    }),
    L.box({
      x: 1810, y: 440, w: 270, h: 170, kind: 'edge',
      title: 'Организация / админ — браузер',
      lines: [
        "/dashboard: Stream'ы, SRT/RTMP-",
        'реквизиты, записи, настройки чата,',
        'живая статистика эфира',
        'admin.liga-live.ru — суперадмин:',
        'организации, заявки, ёмкость',
        'ads.liga-live.ru — реклама',
      ],
    }),
  );

  // ── Разработка и выкатка ─────────────────────────────────────────────────
  b.push(
    L.box({
      x: 30, y: 760, w: 250, h: 100, kind: 'ops',
      title: 'GitHub',
      lines: ['DEMest/StreamService', 'Actions · Issues · CODEOWNERS', 'CI на каждый PR и на main'],
    }),
    L.box({
      x: 30, y: 890, w: 250, h: 100, kind: 'ops',
      title: 'Разработчик + Claude Code',
      lines: ['промпт → код → PR → CI →', 'merge в main = релиз на прод', 'суб-агенты проверок в .claude/'],
    }),
    L.box({
      x: 380, y: 750, w: 240, h: 130, kind: 'ops',
      title: 'CI — self-hosted runner',
      lines: [
        'GitHub Actions на том же хосте',
        'PR: api — build + test,',
        'web — tsc + build',
        'merge в main → SSH → deploy.sh',
        'без docker-сокета и томов',
      ],
    }),
    L.box({
      x: 660, y: 750, w: 240, h: 130, kind: 'ops',
      title: 'Telegram-бот для Issues',
      lines: [
        'services/: свой compose,',
        'Node + MongoDB, DeepSeek',
        '/issue → черновик → Issue',
        'не зависит от API и БД',
      ],
    }),
  );

  // ── Внешние сервисы ──────────────────────────────────────────────────────
  b.push(
    L.box({
      x: 930, y: 950, w: 770, h: 112, kind: 'ext',
      title: 'Внешние сервисы — всё fire-and-forget: их недоступность не влияет на эфир',
      lines: [
        'Поисковики: IndexNow (Яндекс, Bing) и Google Indexing API — пинг страницы трансляции при смене',
        'состояния эфира, троттлинг 10 минут на URL.',
        'Почта: SMTP mail.hosting.reg.ru (своего MTA нет) — заявки, обратная связь, письма о выкатке, тревоги.',
        'Telegram Bot API — дублирование тревог об инцидентах ёмкости.',
      ],
    }),
  );

  // ── Стрелки ──────────────────────────────────────────────────────────────
  b.push(
    // ингест
    L.arrow({ points: [[280, 255], [380, 255]], label: ['SRT :8890/udp', 'RTMP :1935'], labelAt: [330, 232] }),
    // MediaMTX → FFmpeg
    L.arrow({ points: [[530, 310], [530, 360]], label: ['runOnReady →', 'on-ready.sh'], labelAt: [542, 332], anchor: 'start' }),
    // MediaMTX → запись
    L.arrow({
      points: [[395, 310], [395, 600], [700, 600]],
      label: ["запись fmp4 — если у Stream'а", 'включена запись (через control API)'],
      labelAt: [548, 574],
    }),
    // FFmpeg → /hls → API
    L.arrow({ points: [[640, 420], [700, 420]], label: 'пишет', labelAt: [670, 412] }),
    L.arrow({ points: [[880, 420], [930, 420]], label: 'читает', labelAt: [905, 412] }),
    // /recordings → API
    L.arrow({ points: [[880, 600], [930, 600]], label: ['после', 'эфира'], labelAt: [905, 580] }),
    // MediaMTX ↔ API: управление
    L.arrow({
      points: [[640, 200], [930, 200]],
      dashed: true,
      label: ['auth: RTMP-ключ = ingestKey', 'webhook publish / unpublish'],
      labelAt: [785, 176],
    }),
    L.arrow({
      points: [[930, 245], [640, 245]],
      dashed: true,
      label: ['control API :9997: запись on/off,', 'опрос живых путей'],
      labelAt: [785, 262],
    }),
    // Web → API, nginx → Web
    L.arrow({ points: [[1290, 200], [1200, 200]], label: 'rewrite /api/*', labelAt: [1245, 190] }),
    L.arrow({ points: [[1540, 200], [1470, 200]], label: 'HTTP :3000', labelAt: [1505, 190] }),
    // nginx → API: WebSocket мимо web
    L.arrow({
      points: [[1540, 335], [1200, 335]],
      label: 'WS /socket.io/ — чат и счётчик зрителей (мимо web)',
      labelAt: [1370, 326],
    }),
    // Postgres
    L.arrow({ points: [[1290, 415], [1200, 415]], both: true, label: 'Prisma', labelAt: [1245, 406] }),
    // лог nginx → метрики
    L.arrow({ points: [[1540, 515], [1470, 515]], label: 'access_log', labelAt: [1505, 506] }),
    L.arrow({ points: [[1290, 515], [1200, 515]], label: 'tail → метрики', labelAt: [1245, 506] }),
    // S3
    L.arrow({ points: [[1200, 600], [1290, 600]], label: 'заливка архива', labelAt: [1245, 591] }),
    L.arrow({ points: [[1540, 630], [1470, 630]], label: ['presigned', ':9443'], labelAt: [1505, 606] }),
    // браузеры → nginx
    L.arrow({ points: [[1810, 220], [1690, 220]], label: ['HTTPS: страницы,', 'API, HLS .m3u8/.ts'], labelAt: [1750, 196] }),
    L.arrow({ points: [[1810, 300], [1690, 300]], label: ['WS: чат', 'QoE-телеметрия'], labelAt: [1750, 276] }),
    L.arrow({ points: [[1810, 375], [1690, 375]], label: ['архив: 302 →', 'presigned :9443'], labelAt: [1750, 351] }),
    L.arrow({ points: [[1810, 515], [1690, 515]], label: ['дашборд,', "экран Stream'а,", 'admin. / ads.'], labelAt: [1750, 477] }),
    // разработка и выкатка
    L.arrow({ points: [[280, 810], [380, 810]], label: 'джобы CI', labelAt: [330, 800] }),
    L.arrow({ points: [[155, 890], [155, 860]], label: 'PR → merge', labelAt: [165, 880], anchor: 'start' }),
    L.arrow({
      points: [[500, 750], [500, 705], [965, 705], [965, 660]],
      dashed: true,
      label: ['deploy.sh: пересобрать только api + web (--no-deps),', 'health-gate с откатом; MediaMTX не трогается под эфиром'],
      labelAt: [735, 679],
    }),
    // внешние сервисы
    L.arrow({ points: [[1065, 660], [1065, 950]], label: ['пинг поисковикам,', 'письма, тревоги'], labelAt: [1075, 800], anchor: 'start' }),
  );

  const svg = L.render({
    width: W,
    height: H,
    title: 'StreamService (liga-live.ru) — текущая архитектура, сентябрь 2026',
    subtitle: 'Один хост, Docker Compose. Один входящий поток на Stream; сервер не пересобирает кадр — браузер сам кропит нужную камеру из композитной картинки.',
    footer: 'Источник: docs/diagrams/architecture-current.cjs · сборка: node docs/diagrams/build.cjs · описание и планы: docs/vision.md',
    body: b,
  });
  return { svg, width: W, height: H };
}

module.exports = { build };
