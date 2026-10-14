import { Controller, Get, Logger, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { RecordingService } from './recording.service';
import { DOWNLOAD_FILE } from './hls-vod';
import { LiveAccessCache } from './live-access-cache';
import { S3Service } from '../storage/s3.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { canServeMedia } from '../stream/stream-access';
import * as fs from 'fs';
import * as path from 'path';

const HLS_LIVE_ROOT = '/hls/live';

/**
 * Медиа приватного Stream'а живёт по адресу с ключом в пути
 * (`…/private/<key>/…`), публичного — по обычному; см. `stream-access.ts`.
 * Несовпадение адреса с режимом — всегда 404, как и несуществующий стрим:
 * медиа-адрес не отличает «закрыт» от «нет такого».
 *
 * Приватные адреса не попадают в кэширующие локации edge-nginx (их regex ждёт
 * `/streams/<slug>/live/hls/` подряд), поэтому байты закрытого эфира в общем
 * кэше nginx не оседают вовсе.
 */
@Controller()
export class RecordingController {
  private readonly logger = new Logger(RecordingController.name);

  constructor(
    private recording: RecordingService,
    private s3: S3Service,
    private prisma: PrismaService,
    private liveAccess: LiveAccessCache,
  ) {}

  // ─────────── archive HLS ───────────
  // Каждый Stream орги имеет свой набор broadcast'ов; URL включает явный
  // /streams/<streamSlug>/ сегмент.

  @Get('v1/public/orgs/:orgSlug/streams/:streamSlug/broadcasts/:broadcastId/recording/hls/*')
  async serveHlsNamed(
    @Param('orgSlug') orgSlug: string,
    @Param('streamSlug') streamSlug: string,
    @Param('broadcastId') broadcastId: string,
    @Param('0') wildcard: string,
    @Res() res: Response,
  ) {
    this.logger.debug(`serveHlsNamed: orgSlug=${orgSlug} streamSlug=${streamSlug} broadcastId=${broadcastId} wildcard=${JSON.stringify(wildcard)} originalUrl=${res.req.originalUrl}`);
    await this.serveArchiveHlsImpl(orgSlug, streamSlug, undefined, broadcastId, wildcard, res);
  }

  /** Архив приватного Stream'а — только по адресу с текущим ключом. */
  @Get('v1/public/orgs/:orgSlug/streams/:streamSlug/private/:key/broadcasts/:broadcastId/recording/hls/*')
  async serveHlsNamedPrivate(
    @Param('orgSlug') orgSlug: string,
    @Param('streamSlug') streamSlug: string,
    @Param('key') key: string,
    @Param('broadcastId') broadcastId: string,
    @Param('0') wildcard: string,
    @Res() res: Response,
  ) {
    await this.serveArchiveHlsImpl(orgSlug, streamSlug, key, broadcastId, wildcard, res);
  }

  /**
   * Тот же archive HLS, но для дефолтного Stream'а орги (`slug=''`) — без
   * `/streams/<streamSlug>/` сегмента: пустой URL-сегмент между двумя `/` не
   * матчится Express'ом, поэтому это отдельный роут, а не `:streamSlug=''`.
   */
  @Get('v1/public/orgs/:orgSlug/broadcasts/:broadcastId/recording/hls/*')
  async serveHlsDefault(
    @Param('orgSlug') orgSlug: string,
    @Param('broadcastId') broadcastId: string,
    @Param('0') wildcard: string,
    @Res() res: Response,
  ) {
    this.logger.debug(`serveHlsDefault: orgSlug=${orgSlug} broadcastId=${broadcastId} wildcard=${JSON.stringify(wildcard)} originalUrl=${res.req.originalUrl}`);
    await this.serveArchiveHlsImpl(orgSlug, '', undefined, broadcastId, wildcard, res);
  }

  /** Архив приватного дефолтного Stream'а орги — см. serveHlsDefault. */
  @Get('v1/public/orgs/:orgSlug/private/:key/broadcasts/:broadcastId/recording/hls/*')
  async serveHlsDefaultPrivate(
    @Param('orgSlug') orgSlug: string,
    @Param('key') key: string,
    @Param('broadcastId') broadcastId: string,
    @Param('0') wildcard: string,
    @Res() res: Response,
  ) {
    await this.serveArchiveHlsImpl(orgSlug, '', key, broadcastId, wildcard, res);
  }

  /**
   * Реализация archive HLS-сервинга поверх S3, гибридная:
   *
   *  - `.m3u8`-плейлисты (крошечный текст) ПРОКСИРУЮТСЯ через API. Это не
   *    оптимизационный компромисс, а условие работоспособности: hls.js
   *    резолвит относительные URI плейлиста против ФИНАЛЬНОГО URL ответа
   *    (`xhr.responseURL`). Если бы плейлист отдавался 302-редиректом на S3,
   *    `download.mp4` резолвился бы в S3-адрес БЕЗ подписи → 403 на каждый
   *    кусок приватного бакета. Прокси же оставляет базой API-URL, и каждый
   *    кусок приходит сюда за собственным свежеподписанным редиректом.
   *  - MP4 (тяжёлые байты) — presigned 302 в S3, мимо канала API. Плеер
   *    просит у download.mp4 байтовые диапазоны (`EXT-X-BYTERANGE`); заголовок
   *    Range браузер переносит через редирект, и S3 отдаёт 206 только кусок.
   *
   * S3-ключ вычисляется через getRecordingKeyPrefix(broadcastId); streamSlug
   * используется только для tenancy-фильтра в БД (404 на чужие пути).
   * Режим доступа проверяется на КАЖДЫЙ запрос, включая байтовые куски
   * download.mp4: presigned-ссылка выдаётся на минуты, а не на сеанс.
   */
  private async serveArchiveHlsImpl(
    orgSlug: string,
    streamSlug: string,
    pathKey: string | undefined,
    broadcastId: string,
    wildcard: string,
    res: Response,
  ) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: {
        id: broadcastId,
        stream: { slug: streamSlug, org: { slug: orgSlug, isActive: true } },
      },
      select: { id: true, stream: { select: { isPublic: true, previewKey: true } } },
    });
    if (!broadcast || !canServeMedia(broadcast.stream, pathKey)) {
      res.status(404).json({ message: 'Broadcast not found' });
      return;
    }

    let relativePath = decodeURIComponent(wildcard ?? '');
    relativePath = relativePath.split('?')[0];

    if (!relativePath) {
      res.status(400).json({ message: 'File path required' });
      return;
    }

    if (!relativePath.endsWith('.m3u8') && !relativePath.endsWith('.ts') && !relativePath.endsWith('.mp4')) {
      res.status(403).json({ message: 'Forbidden file type' });
      return;
    }
    if (relativePath.includes('..')) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    const keyPrefix = await this.recording.getRecordingKeyPrefix(broadcastId);
    const key = `${keyPrefix}/${relativePath}`;

    if (relativePath.endsWith('.m3u8')) {
      try {
        const body = await this.s3.getObjectText(key);
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(body);
      } catch {
        res.status(404).json({ message: 'Playlist not found' });
      }
      return;
    }

    const url = await this.s3.getPresignedUrl(key);
    res.redirect(302, url);
  }

  // ─────────── live HLS ───────────
  // HLS-output лежит под /hls/live/<orgSlug>/<streamSlug>/... (соответствует
  // MediaMTX path 'live/<orgSlug>/<streamSlug>').

  /**
   * Публичный адрес эфира. `?key=` здесь намеренно не читается: у приватного
   * Stream'а этот адрес закрыт всегда, с любым query.
   */
  @Get('v1/public/orgs/:orgSlug/streams/:streamSlug/live/hls/*')
  async serveLiveHlsNamed(
    @Param('orgSlug') orgSlug: string,
    @Param('streamSlug') streamSlug: string,
    @Param('0') wildcard: string,
    @Res() res: Response,
  ) {
    this.logger.debug(`serveLiveHlsNamed: orgSlug=${orgSlug} streamSlug=${streamSlug} wildcard=${JSON.stringify(wildcard)} originalUrl=${res.req.originalUrl}`);
    await this.serveLiveHlsImpl(orgSlug, streamSlug, undefined, wildcard, res);
  }

  /** Эфир приватного Stream'а — только по адресу с текущим ключом. */
  @Get('v1/public/orgs/:orgSlug/streams/:streamSlug/private/:key/live/hls/*')
  async serveLiveHlsPrivate(
    @Param('orgSlug') orgSlug: string,
    @Param('streamSlug') streamSlug: string,
    @Param('key') key: string,
    @Param('0') wildcard: string,
    @Res() res: Response,
  ) {
    await this.serveLiveHlsImpl(orgSlug, streamSlug, key, wildcard, res);
  }

  /**
   * Реализация live HLS-проксирования с диска.
   *
   * liveDir = /hls/live/<orgSlug>/<streamSlug>. Внутри — файлы по правилам
   * FFmpeg/HLS: master.m3u8 + сегменты. Каталог на диске один на оба адреса —
   * режим доступа решает, какой из них сейчас открыт.
   */
  private async serveLiveHlsImpl(
    orgSlug: string,
    streamSlug: string,
    pathKey: string | undefined,
    wildcard: string,
    res: Response,
  ) {
    const visibility = await this.liveAccess.get(orgSlug, streamSlug);
    if (!visibility || !canServeMedia(visibility, pathKey)) {
      res.status(404).json({ message: 'Stream not found' });
      return;
    }

    const liveDir = path.resolve(path.join(HLS_LIVE_ROOT, orgSlug, streamSlug));

    let relativePath = decodeURIComponent(wildcard ?? '');
    relativePath = relativePath.split('?')[0];

    if (!relativePath) {
      res.status(400).json({ message: 'File path required' });
      return;
    }

    if (!relativePath.endsWith('.m3u8') && !relativePath.endsWith('.ts') && !relativePath.endsWith('.mp4')) {
      res.status(403).json({ message: 'Forbidden file type' });
      return;
    }

    const resolved = path.resolve(liveDir, relativePath);
    if (resolved !== liveDir && !resolved.startsWith(liveDir + path.sep)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    if (!fs.existsSync(resolved)) {
      res.status(404).json({ message: 'File not found' });
      return;
    }

    if (relativePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (relativePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
    } else {
      res.setHeader('Content-Type', 'video/mp2t');
    }
    // Live HLS-сегменты ротируются — кэш на промежуточных прокси (включая
    // Next.js fetch-cache) приводит к 404 на удалённые segs и наоборот к
    // отдаче несвежего manifest. no-store + revalidate отключают любой кэш.
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const stat = fs.statSync(resolved);
    const fileSize = stat.size;
    const range = res.req.headers.range;

    res.setHeader('Accept-Ranges', 'bytes');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', end - start + 1);
      fs.createReadStream(resolved, { start, end }).pipe(res);
    } else {
      res.setHeader('Content-Length', fileSize);
      fs.createReadStream(resolved).pipe(res);
    }
  }

  @Get('v1/org/broadcasts/:broadcastId/recording/download')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('org_admin')
  async downloadRecording(
    @CurrentUser() user: JwtPayload,
    @Param('broadcastId') broadcastId: string,
    @Res() res: Response,
  ) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, stream: { orgId: user.orgId } },
    });
    if (!broadcast) {
      res.status(404).json({ message: 'Broadcast not found' });
      return;
    }

    const keyPrefix = await this.recording.getRecordingKeyPrefix(broadcastId, 1);
    const key = `${keyPrefix}/${DOWNLOAD_FILE}`;
    const fileName = `${broadcast.title.replace(/[^a-zA-Z0-9а-яА-ЯёЁ\s_-]/g, '')}.mp4`;

    const url = await this.s3.getPresignedUrl(key, {
      responseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
    res.redirect(302, url);
  }
}
