import { Controller, Get, Logger, Param, Res, UseGuards } from '@nestjs/common';
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
import { spawn } from 'child_process';
import { randomBytes } from 'crypto';

const HLS_LIVE_ROOT = '/hls/live';

@Controller()
export class RecordingController {
  private readonly logger = new Logger(RecordingController.name);

  constructor(
    private recording: RecordingService,
    private prisma: PrismaService,
  ) {}

  @Get('v1/public/orgs/:orgSlug/broadcasts/:broadcastId/recording/hls/*')
  async serveHls(
    @Param('orgSlug') orgSlug: string,
    @Param('broadcastId') broadcastId: string,
    @Param('0') wildcard: string,
    @Res() res: Response,
  ) {
    this.logger.log(`serveHls: orgSlug=${orgSlug} broadcastId=${broadcastId} wildcard=${JSON.stringify(wildcard)} originalUrl=${res.req.originalUrl}`);

    const broadcast = await this.prisma.broadcast.findFirst({
      where: {
        id: broadcastId,
        stream: { slug: '', org: { slug: orgSlug, isActive: true } },
      },
    });
    if (!broadcast) {
      res.status(404).json({ message: 'Broadcast not found' });
      return;
    }

    const recordingDir = await this.recording.getRecordingDir(broadcastId);

    let relativePath = decodeURIComponent(wildcard ?? '');
    relativePath = relativePath.split('?')[0];

    if (!relativePath) {
      res.status(400).json({ message: 'File path required' });
      return;
    }

    // Only allow .m3u8, .ts, and .mp4 files
    if (!relativePath.endsWith('.m3u8') && !relativePath.endsWith('.ts') && !relativePath.endsWith('.mp4')) {
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
    } else if (relativePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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
    @Param('0') wildcard: string,
    @Res() res: Response,
  ) {
    this.logger.log(`serveLiveHls: orgSlug=${orgSlug} wildcard=${JSON.stringify(wildcard)} originalUrl=${res.req.originalUrl}`);

    const org = await this.prisma.organization.findFirst({
      where: { slug: orgSlug, isActive: true },
    });
    if (!org) {
      res.status(404).json({ message: 'Organization not found' });
      return;
    }

    const liveDir = path.join(HLS_LIVE_ROOT, orgSlug);

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
    } else if (relativePath.endsWith('.mp4')) {
      res.setHeader('Content-Type', 'video/mp4');
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
      where: { id: broadcastId, stream: { orgId: user.orgId } },
    });
    if (!broadcast) {
      res.status(404).json({ message: 'Broadcast not found' });
      return;
    }

    const recordingDir = await this.recording.getRecordingDir(broadcastId, 1);
    const slotDir = path.join(recordingDir, 'slot-1');

    // Legacy fallback for old recordings
    if (!fs.existsSync(slotDir)) {
      const legacyMp4 = path.join(recordingDir, 'original.mp4');
      if (fs.existsSync(legacyMp4)) {
        return this.serveLegacyMp4Download(legacyMp4, broadcast.title, res);
      }
      res.status(404).json({ message: 'Recording file not found' });
      return;
    }

    const segments = fs.readdirSync(slotDir)
      .filter(f => f.startsWith('seg-') && f.endsWith('.mp4'))
      .sort();
    if (segments.length === 0) {
      res.status(404).json({ message: 'No segments to download' });
      return;
    }

    const listFile = path.join(slotDir, `_download_${randomBytes(8).toString('hex')}.txt`);
    const listContent = segments.map(f => `file '${path.join(slotDir, f).replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(listFile, listContent);

    const fileName = `${broadcast.title.replace(/[^a-zA-Z0-9а-яА-ЯёЁ\s_-]/g, '')}.mp4`;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', 'video/mp4');

    const ff = spawn('ffmpeg', [
      '-f', 'concat', '-safe', '0',
      '-i', listFile,
      '-c', 'copy',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4',
      'pipe:1',
    ]);

    let stderr = '';
    ff.stderr.on('data', chunk => { stderr += chunk.toString(); });
    ff.stdout.pipe(res);

    ff.on('exit', (code) => {
      try { fs.unlinkSync(listFile); } catch { /* ignore */ }
      if (code !== 0) {
        console.error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`);
        if (!res.headersSent) {
          res.status(500).json({ message: 'Failed to generate download' });
        } else {
          res.end();
        }
      }
    });

    ff.on('error', err => {
      try { fs.unlinkSync(listFile); } catch { /* ignore */ }
      if (!res.headersSent) {
        res.status(500).json({ message: `ffmpeg error: ${err.message}` });
      } else {
        res.end();
      }
    });
  }

  private serveLegacyMp4Download(filePath: string, title: string, res: Response) {
    const fileName = `${title.replace(/[^a-zA-Z0-9а-яА-ЯёЁ\s_-]/g, '')}.mp4`;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', 'video/mp4');
    const stat = fs.statSync(filePath);
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(filePath).pipe(res);
  }
}
