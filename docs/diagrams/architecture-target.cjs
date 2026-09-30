'use strict';

// Целевая архитектура StreamService (to-be) — куда развивается продукт по
// docs/vision.md. Цвет коробки говорит, что с ней происходит относительно
// текущей схемы: красная — новое, жёлтая — меняется, остальные — как сейчас.

function build(L) {
  const W = 2300;
  const H = 1260;
  const b = [];

  b.push(
    L.legend({
      x: 1500,
      y: 40,
      items: [
        { type: 'solid', label: 'медиа и данные' },
        { type: 'dashed', label: 'управление и сигналы' },
        { type: 'kind', kind: 'new', label: 'новое' },
        { type: 'kind', kind: 'changed', label: 'меняется' },
        { type: 'kind', kind: 'app', label: 'без изменений' },
      ],
    }),
  );

  // ── Кластер ──────────────────────────────────────────────────────────────
  b.push(
    L.group({
      x: 330, y: 100, w: 1400, h: 1000,
      label: 'Kubernetes-кластер (k3s на старте: 2–3 узла) · пул media — hostNetwork, UDP-ингест · пул app — Deployments, HPA, rolling update',
    }),
    L.group({ x: 350, y: 140, w: 370, h: 230, label: 'Пул media-узлов', fill: '#FFFFFF' }),
    L.group({ x: 740, y: 415, w: 730, h: 380, label: 'Пул app-узлов', fill: '#FFFFFF' }),
    L.group({ x: 350, y: 740, w: 370, h: 340, label: 'Наблюдаемость', fill: '#FFFFFF' }),
    L.group({ x: 1990, y: 140, w: 290, h: 640, label: 'Клиенты', fill: '#FFFFFF' }),
  );

  // ── Слева: кодер, CI, GitHub, разработчик ────────────────────────────────
  b.push(
    L.box({
      x: 30, y: 170, w: 250, h: 175, kind: 'media',
      title: 'Кодер организации',
      lines: [
        'vMix / OBS на площадке',
        'один поток на Stream:',
        'композит 2×2 или один ракурс',
        'SRT passphrase / RTMP-ключ',
        '= ingestKey — без изменений',
        'ингест-адрес стабилен при',
        'переезде на кластер',
      ],
    }),
    L.box({
      x: 30, y: 400, w: 250, h: 140, kind: 'changed',
      title: 'CI — GitHub Actions',
      lines: [
        'PR: build, tests, tsc, lint,',
        'e2e (Playwright), k6-нагрузка',
        'merge → образ в GHCR (тег = SHA)',
        'self-hosted или hosted runner',
      ],
    }),
    L.box({
      x: 30, y: 570, w: 250, h: 110, kind: 'ops',
      title: 'GitHub',
      lines: ['репозиторий, Issues, Projects', 'CODEOWNERS, ревью ботом', 'Telegram-бот → Issues'],
    }),
    L.box({
      x: 30, y: 720, w: 250, h: 110, kind: 'ops',
      title: 'Разработчик + Claude Code',
      lines: ['промпт → PR → CI → merge', 'суб-агенты проверок', '= релиз через GitOps'],
    }),
  );

  // ── Медиа-путь ───────────────────────────────────────────────────────────
  b.push(
    L.box({
      x: 370, y: 178, w: 330, h: 165, kind: 'changed',
      title: 'Ingest-под: MediaMTX + FFmpeg',
      lines: [
        'Service LoadBalancer (UDP/TCP), стабильный',
        'IP/DNS ингеста; hostNetwork на узле',
        'запись fmp4 → общее S3-хранилище',
        'пакетировщик: hd copy + лесенка (NVENC/QSV',
        'по необходимости); пишет HLS в origin',
        'PDB: под не рестартуют, пока идёт эфир',
        "масштаб: + узел = + N Stream'ов",
      ],
    }),
    L.store({
      x: 750, y: 180, w: 200, h: 170, kind: 'changed',
      title: 'Origin-хранилище HLS',
      lines: [
        'S3-совместимое / общий PV',
        'live-сегменты, записи fmp4,',
        'архив HLS-VOD + MP4',
        'signed URL для приватных',
        'API больше не отдаёт HLS',
      ],
    }),
    L.box({
      x: 990, y: 230, w: 230, h: 145, kind: 'new',
      title: 'ai-commentary',
      lines: [
        'читает копию p480 из origin',
        'кадры + звук → LLM/vision →',
        'события боя → текст → чат;',
        'TTS → доп. аудиодорожка',
        'после эфира: саммари,',
        'хайлайты, главы архива',
      ],
    }),
    L.box({
      x: 1760, y: 150, w: 190, h: 200, kind: 'new',
      title: 'CDN',
      lines: [
        'кэш HLS рядом со зрителем',
        'live + архив + статика',
        'pull из origin при промахе',
        'signed URL / previewKey',
        'egress уходит с сервера',
        'в сеть CDN',
      ],
    }),
  );

  // ── Шина событий ─────────────────────────────────────────────────────────
  b.push(
    L.bus({
      x1: 750, x2: 1460, y: 400,
      labels: [
        { x: 985, text: 'шина событий (Redis Streams / NATS)' },
        { x: 1225, text: 'broadcast.*, recording.ready' },
      ],
    }),
  );

  // ── Сервисы пула app ─────────────────────────────────────────────────────
  b.push(
    L.box({
      x: 760, y: 445, w: 210, h: 140, kind: 'new',
      title: 'ingest-control',
      lines: [
        'auth + webhook для MediaMTX',
        'control API: запись on/off',
        'Broadcast start/stop → события',
        'маленький и высокодоступный:',
        'лёг он — не принимается эфир',
      ],
    }),
    L.box({
      x: 1000, y: 445, w: 210, h: 140, kind: 'new',
      title: 'archive-worker',
      lines: [
        'consumer: broadcast.ended',
        'ffprobe + ffmpeg -c copy →',
        'HLS-VOD + MP4 → S3 (как сейчас)',
        'cron: чистка, retry, glue',
        'свой узел под CPU и диск',
      ],
    }),
    L.box({
      x: 1240, y: 445, w: 210, h: 140, kind: 'new',
      title: 'notifier',
      lines: [
        'outbox: почта, Telegram,',
        'SEO-пинг, push (FCM/APNs)',
        'ретраи и дедупликация',
        'fire-and-forget, но вне API',
      ],
    }),
    L.box({
      x: 760, y: 640, w: 210, h: 140, kind: 'changed',
      title: 'api-core (NestJS)',
      lines: [
        'auth, org, stream, каталог,',
        'admin, ads, SEO-правила',
        'без HLS-раздачи и cron',
        'stateless → N реплик (HPA)',
        'Bearer JWT для мобильных',
      ],
    }),
    L.box({
      x: 1000, y: 640, w: 210, h: 140, kind: 'new',
      title: 'chat-gateway',
      lines: [
        'Socket.io + Redis-адаптер',
        'комнаты на Stream, presence',
        'счётчик зрителей в Redis',
        'реплики — по соединениям',
        'вход для AI-комментария',
      ],
    }),
    L.box({
      x: 1240, y: 640, w: 210, h: 140, kind: 'app',
      title: 'web (Next.js) + PWA',
      lines: [
        'SSR, /api/* → api-core',
        'плеер hls.js + <canvas>',
        'N реплик',
        'PWA + Web Push — шаг 0',
        'к мобильным приложениям',
      ],
    }),
  );

  // ── Данные ───────────────────────────────────────────────────────────────
  b.push(
    L.store({
      x: 760, y: 850, w: 210, h: 100,
      title: 'PostgreSQL',
      lines: ['managed / оператор в k8s', 'одна БД на старте; владение', 'таблицами — по сервисам'],
    }),
    L.store({
      x: 1000, y: 850, w: 450, h: 100, kind: 'new',
      title: 'Redis',
      lines: ['адаптер Socket.io, presence и счётчик зрителей,', 'кэш каталога, rate-limit, очереди BullMQ'],
    }),
  );

  // ── GitOps и наблюдаемость ───────────────────────────────────────────────
  b.push(
    L.box({
      x: 370, y: 590, w: 330, h: 120, kind: 'new',
      title: 'Argo CD — GitOps',
      lines: [
        'манифесты из Git, образы GHCR (тег = SHA)',
        'rolling update api / web / сервисов',
        'preview-namespace на каждый PR',
        'media-поды — только без эфира или force',
      ],
    }),
    L.box({
      x: 370, y: 770, w: 330, h: 75, kind: 'new', size: 12,
      title: 'Prometheus + Grafana',
      lines: ['node-exporter, cAdvisor, kube-state-metrics,', 'MediaMTX (metrics: yes), FFmpeg progress'],
    }),
    L.box({
      x: 370, y: 855, w: 330, h: 60, kind: 'new', size: 12,
      title: 'Loki + Promtail',
      lines: ['логи всех подов, поиск по broadcastId'],
    }),
    L.box({
      x: 370, y: 925, w: 330, h: 75, kind: 'new', size: 12,
      title: 'Sentry (self-hosted / SaaS)',
      lines: ['ошибки api, web и приложений; source maps,', 'release = SHA, теги org / stream / broadcast'],
    }),
    L.box({
      x: 370, y: 1010, w: 330, h: 60, kind: 'new', size: 12,
      title: 'Headlamp / Kubernetes Dashboard',
      lines: ['поды, узлы, rollout; Alertmanager → Telegram'],
    }),
  );

  // ── Граница сети и клиенты ───────────────────────────────────────────────
  b.push(
    L.box({
      x: 1540, y: 400, w: 150, h: 160, kind: 'changed',
      title: 'Ingress (nginx)',
      lines: ['TLS, cert-manager', '/ → web', '/api → api-core', '/socket.io → chat', 'limit_req, WAF-lite', 'хосты admin., ads.'],
    }),
    L.box({
      x: 2005, y: 180, w: 260, h: 150, kind: 'edge',
      title: 'Браузер',
      lines: ['hls.js + <canvas>-кроп', 'чат, QoE-телеметрия', 'как сейчас'],
    }),
    L.box({
      x: 2005, y: 360, w: 260, h: 190, kind: 'new',
      title: 'Мобильные приложения',
      lines: [
        'iOS / Android (React Native',
        'или Flutter), тот же API',
        'нативный HLS: AVPlayer /',
        'ExoPlayer; кроп квадранта —',
        'трансформация view',
        'push: «эфир начался»',
      ],
    }),
    L.box({
      x: 2005, y: 580, w: 260, h: 170, kind: 'new',
      title: 'Приложение организации',
      lines: ['студия: старт/стоп, статистика', 'эфира, ротация ключа,', 'уведомления об инцидентах'],
    }),
    L.box({
      x: 1770, y: 840, w: 500, h: 140, kind: 'ext',
      title: 'Внешние сервисы',
      lines: [
        'SMTP, Telegram Bot API — как сейчас',
        'IndexNow / Google Indexing API — SEO-пинг',
        'FCM / APNs — push в приложения',
        'LLM / TTS-провайдер или локальная модель —',
        'для AI-комментатора',
      ],
    }),
  );

  // ── Что меняется ─────────────────────────────────────────────────────────
  b.push(
    L.box({
      x: 330, y: 1120, w: 1400, h: 110, kind: 'ext', size: 12,
      title: 'Что меняется относительно текущей схемы (docs/architecture-current.png)',
      lines: [
        '1. API больше не отдаёт HLS: пакетировщик пишет сегменты в origin-хранилище, зрителям раздаёт CDN.   2. Монолит → ядро + сервисы на шине событий (ingest-control, archive-worker, notifier, chat-gateway, ai-commentary).',
        '3. Один хост и Compose → кластер с пулами media / app; медиа-поды не рестартуют под эфиром (правило deploy.sh переезжает в PDB).   4. Наблюдаемость: метрики, логи, ошибки, UI по подам и узлам.',
        '5. Мобильные приложения и PWA работают через тот же api-core (Bearer JWT, push).   6. AI-комментатор читает копию p480 и пишет в чат / отдельную аудиодорожку — основной фид по-прежнему никто не трогает.',
      ],
    }),
  );

  // ── Стрелки ──────────────────────────────────────────────────────────────
  b.push(
    // ингест
    L.arrow({ points: [[280, 255], [370, 255]], label: ['SRT / RTMP', '→ LB (UDP)'], labelAt: [325, 232] }),
    L.arrow({ points: [[700, 250], [750, 250]], label: ['HLS,', 'fmp4'], labelAt: [725, 228] }),
    // origin → CDN → клиенты
    L.arrow({
      points: [[950, 200], [1760, 200]],
      label: 'pull при промахе кэша; сегменты 2 с (LL-HLS — позже)',
      labelAt: [1355, 190],
    }),
    L.arrow({ points: [[1950, 250], [1990, 250]], label: 'HLS', labelAt: [1970, 240] }),
    // origin ↔ AI
    L.arrow({ points: [[950, 290], [990, 290]], label: 'p480', labelAt: [970, 280] }),
    L.arrow({ points: [[990, 330], [950, 330]], label: 'TTS', labelAt: [970, 348] }),
    // MediaMTX ↔ ingest-control
    L.arrow({
      points: [[535, 343], [535, 500], [760, 500]],
      dashed: true,
      label: 'auth + webhook publish / unpublish',
      labelAt: [650, 490],
    }),
    L.arrow({
      points: [[760, 545], [500, 545], [500, 343]],
      dashed: true,
      label: 'control API: запись on/off',
      labelAt: [640, 560],
    }),
    // шина событий
    L.arrow({ points: [[865, 445], [865, 400]], dashed: true }),
    L.arrow({ points: [[1105, 375], [1105, 400]], dashed: true }),
    L.arrow({ points: [[1105, 400], [1105, 445]], dashed: true }),
    L.arrow({ points: [[1345, 400], [1345, 445]], dashed: true }),
    // сервисы ↔ данные
    L.arrow({ points: [[865, 780], [865, 850]], label: 'Prisma', labelAt: [873, 818], anchor: 'start' }),
    L.arrow({ points: [[1105, 780], [1105, 850]], label: ['адаптер,', 'presence'], labelAt: [1113, 810], anchor: 'start' }),
    // Ingress → сервисы, клиенты → Ingress
    L.arrow({ points: [[1540, 470], [1470, 470]], label: 'HTTP, WS', labelAt: [1505, 460] }),
    L.arrow({
      points: [[1990, 480], [1690, 480]],
      label: 'HTTPS: страницы, REST (Bearer JWT), WS-чат',
      labelAt: [1840, 470],
    }),
    // notifier → внешние, push → клиенты
    L.arrow({
      points: [[1450, 545], [1480, 545], [1480, 910], [1770, 910]],
      dashed: true,
      label: 'почта, Telegram, SEO-пинг, push',
      labelAt: [1625, 900],
    }),
    L.arrow({ points: [[2100, 840], [2100, 780]], dashed: true, label: 'push (FCM / APNs)', labelAt: [2110, 815], anchor: 'start' }),
    // GitOps
    L.arrow({ points: [[280, 630], [370, 630]], label: ['образы (GHCR),', 'манифесты'], labelAt: [325, 608] }),
    L.arrow({ points: [[155, 570], [155, 540]], label: 'джобы', labelAt: [165, 560], anchor: 'start' }),
    L.arrow({ points: [[155, 720], [155, 680]], label: 'PR → CI → merge', labelAt: [165, 705], anchor: 'start' }),
    L.arrow({ points: [[700, 650], [740, 650]], dashed: true, label: 'выкатка', labelAt: [720, 640] }),
    L.arrow({ points: [[420, 590], [420, 370]], dashed: true, label: ['без эфира', 'или force'], labelAt: [428, 470], anchor: 'start' }),
  );

  const svg = L.render({
    width: W,
    height: H,
    title: 'StreamService — целевая архитектура (to-be)',
    subtitle: [
      'Нагрузка, разделение на сервисы, AI-комментатор, мобильные клиенты, инструменты разработки и наблюдаемость.',
      'Принцип не меняется: один входящий поток на Stream, серверной пересборки кадра нет. Меняется доставка потока, разрез приложения на сервисы и наблюдение за ним.',
    ],
    footer: 'Источник: docs/diagrams/architecture-target.cjs · сборка: node docs/diagrams/build.cjs · этапы и обоснование: docs/vision.md',
    body: b,
  });
  return { svg, width: W, height: H };
}

module.exports = { build };
