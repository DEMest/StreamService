import { Controller, Get, Logger, Param, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { RecordingService } from './recording.service';
import { S3Service } from '../storage/s3.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { PrismaService } from '../prisma/prisma.service';
import * as fs from 'fs';
import * as path from 'path';

const HLS_LIVE_ROOT = '/hls/live';

@Controller()
export class RecordingController {
  private readonly logger = new Logger(RecordingController.name);

  constructor(
    private recording: RecordingService,
    private s3: S3Service,
    private prisma: PrismaService,
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
    this.logger.log(`serveHlsNamed: orgSlug=${orgSlug} streamSlug=${streamSlug} broadcastId=${broadcastId} wildcard=${JSON.stringify(wildcard)} originalUrl=${res.req.originalUrl}`);
    await this.serveArchiveHlsImpl(orgSlug, streamSlug, broadcastId, wildcard, res);
  }

  /**
   * Реализация archive HLS-сервинга — presigned-редирект в S3, БЕЗ проксирования
   * байтов через сервер (иначе трафик архива удваивал бы нагрузку на канал API
   * при одновременном просмотре несколькими зрителями).
   *
   * S3-ключ вычисляется через getRecordingKeyPrefix(broadcastId), который читает
   * broadcast.streamId и возвращает S3-префикс сам. streamSlug используется
   * только для запроса к БД (фильтр по nested Stream, чтобы 404-ить чужие/
   * несуществующие пути) — не участвует в вычислении S3-ключа.
   */
  private async serveArchiveHlsImpl(
    orgSlug: string,
    streamSlug: string,
    broadcastId: string,
    wildcard: string,
    res: Response,
  ) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: {
        id: broadcastId,
        stream: { slug: streamSlug, org: { slug: orgSlug, isActive: true } },
      },
    });
    if (!broadcast) {
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
    const url = await this.s3.getPresignedUrl(key);
    res.redirect(302, url);
  }

  // ─────────── live HLS ───────────
  // HLS-output лежит под /hls/live/<orgSlug>/<streamSlug>/... (соответствует
  // MediaMTX path 'live/<orgSlug>/<streamSlug>').

  @Get('v1/public/orgs/:orgSlug/streams/:streamSlug/live/hls/*')
  async serveLiveHlsNamed(
    @Param('orgSlug') orgSlug: string,
    @Param('streamSlug') streamSlug: string,
    @Param('0') wildcard: string,
    @Query('key') key: string | undefined,
    @Res() res: Response,
  ) {
    this.logger.log(`serveLiveHlsNamed: orgSlug=${orgSlug} streamSlug=${streamSlug} wildcard=${JSON.stringify(wildcard)} originalUrl=${res.req.originalUrl}`);
    await this.serveLiveHlsImpl(orgSlug, streamSlug, wildcard, key, res);
  }

  /**
   * Реализация live HLS-проксирования с диска.
   *
   * liveDir = /hls/live/<orgSlug>/<streamSlug>. Внутри — файлы по правилам
   * FFmpeg/HLS: master.m3u8 + сегменты.
   */
  private async serveLiveHlsImpl(
    orgSlug: string,
    streamSlug: string,
    wildcard: string,
    key: string | undefined,
    res: Response,
  ) {
    const stream = await this.prisma.stream.findFirst({
      where: { slug: streamSlug, org: { slug: orgSlug, isActive: true } },
      select: { isPublic: true, previewKey: true },
    });
    if (!stream) {
      res.status(404).json({ message: 'Stream not found' });
      return;
    }
    if (!stream.isPublic && stream.previewKey !== key) {
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
    const key = `${keyPrefix}/download.mp4`;
    const fileName = `${broadcast.title.replace(/[^a-zA-Z0-9а-яА-ЯёЁ\s_-]/g, '')}.mp4`;

    const url = await this.s3.getPresignedUrl(key, {
      responseContentDisposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
    res.redirect(302, url);
  }
}
