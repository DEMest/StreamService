import { Controller, Get, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { RecordingService } from './recording.service';
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
  constructor(
    private recording: RecordingService,
    private prisma: PrismaService,
  ) {}

  @Get('v1/public/orgs/:orgSlug/broadcasts/:broadcastId/recording/hls/*')
  async serveHls(
    @Param('orgSlug') orgSlug: string,
    @Param('broadcastId') broadcastId: string,
    @Res() res: Response,
  ) {
    const broadcast = await this.prisma.broadcast.findFirst({
      where: { id: broadcastId, org: { slug: orgSlug, isActive: true } },
    });
    if (!broadcast) {
      res.status(404).json({ message: 'Broadcast not found' });
      return;
    }

    const recordingDir = await this.recording.getRecordingDir(broadcastId);

    // Extract the wildcard path after /hls/
    const fullPath = res.req.originalUrl;
    const hlsPrefix = `/v1/public/orgs/${orgSlug}/broadcasts/${broadcastId}/recording/hls/`;
    let relativePath = decodeURIComponent(fullPath.split(hlsPrefix)[1] || '');
    // Strip query string if present
    relativePath = relativePath.split('?')[0];

    if (!relativePath) {
      res.status(400).json({ message: 'File path required' });
      return;
    }

    // Only allow .m3u8 and .ts files
    if (!relativePath.endsWith('.m3u8') && !relativePath.endsWith('.ts')) {
      res.status(403).json({ message: 'Forbidden file type' });
      return;
    }

    // Path traversal protection
    const resolved = path.resolve(recordingDir, relativePath);
    if (!resolved.startsWith(recordingDir)) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    if (!fs.existsSync(resolved)) {
      res.status(404).json({ message: 'File not found' });
      return;
    }

    // Content-Type and caching
    if (relativePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }

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

  @Get('v1/public/orgs/:orgSlug/live/hls/*')
  async serveLiveHls(
    @Param('orgSlug') orgSlug: string,
    @Res() res: Response,
  ) {
    const org = await this.prisma.organization.findFirst({
      where: { slug: orgSlug, isActive: true },
    });
    if (!org) {
      res.status(404).json({ message: 'Organization not found' });
      return;
    }

    const liveDir = path.join(HLS_LIVE_ROOT, orgSlug);

    const fullPath = res.req.originalUrl;
    const hlsPrefix = `/v1/public/orgs/${orgSlug}/live/hls/`;
    let relativePath = decodeURIComponent(fullPath.split(hlsPrefix)[1] || '');
    relativePath = relativePath.split('?')[0];

    if (!relativePath) {
      res.status(400).json({ message: 'File path required' });
      return;
    }

    if (!relativePath.endsWith('.m3u8') && !relativePath.endsWith('.ts')) {
      res.status(403).json({ message: 'Forbidden file type' });
      return;
    }

    const resolved = path.resolve(liveDir, relativePath);
    if (!resolved.startsWith(path.resolve(liveDir))) {
      res.status(403).json({ message: 'Forbidden' });
      return;
    }

    if (!fs.existsSync(resolved)) {
      res.status(404).json({ message: 'File not found' });
      return;
    }

    if (relativePath.endsWith('.m3u8')) {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else {
      res.setHeader('Content-Type', 'video/mp2t');
    }
    res.setHeader('Cache-Control', 'no-cache');

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
      where: { id: broadcastId, orgId: user.orgId },
    });
    if (!broadcast) {
      res.status(404).json({ message: 'Broadcast not found' });
      return;
    }

    const recordingDir = await this.recording.getRecordingDir(broadcastId);
    const filePath = path.join(recordingDir, 'original.mp4');

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ message: 'Recording file not found' });
      return;
    }

    const fileName = `${broadcast.title.replace(/[^a-zA-Z0-9а-яА-ЯёЁ\s_-]/g, '')}.mp4`;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const stat = fs.statSync(filePath);
    res.setHeader('Content-Length', stat.size);

    fs.createReadStream(filePath).pipe(res);
  }
}
