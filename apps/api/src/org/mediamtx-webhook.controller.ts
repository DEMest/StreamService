import { Body, Controller, Headers, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { OrgService } from './org.service';

@Controller('v1/internal/mediamtx')
export class MediamtxWebhookController {
  private readonly logger = new Logger(MediamtxWebhookController.name);

  constructor(private org: OrgService) {}

  @Post('auth')
  async handleAuth(
    @Body() body: {
      user?: string;
      password?: string;
      ip?: string;
      action?: string;
      path?: string;
      protocol?: string;
      query?: string;
    },
  ) {
    // Allow all reads (viewers, FFmpeg RTSP reader)
    if (body.action !== 'publish') return { ok: true };

    // SRT publish — passphrase already verified at transport level
    if (body.protocol === 'srt') return { ok: true };

    // RTMP/RTSP publish — verify ingestKey
    const match = body.path?.match(/^live\/(.+)$/);
    if (!match) {
      this.logger.warn(`Auth rejected: invalid path "${body.path}" from ${body.ip}`);
      throw new UnauthorizedException('Invalid path');
    }

    const orgSlug = match[1];
    const params = new URLSearchParams(body.query ?? '');
    const key = params.get('key') || body.password;

    if (!key) {
      this.logger.warn(`RTMP auth rejected for "${orgSlug}": no key provided (${body.ip})`);
      throw new UnauthorizedException('No key provided');
    }

    const valid = await this.org.verifyIngestKey(orgSlug, key);
    if (!valid) {
      this.logger.warn(`RTMP auth rejected for "${orgSlug}": invalid key (${body.ip})`);
      throw new UnauthorizedException('Invalid key');
    }

    this.logger.log(`RTMP auth accepted for "${orgSlug}" (${body.ip})`);
    return { ok: true };
  }

  @Post('webhook')
  async handleWebhook(
    @Headers('authorization') auth: string,
    @Body() body: { action: string; path: string },
  ) {
    const secret = process.env.MEDIAMTX_WEBHOOK_SECRET;
    if (secret && auth !== `Bearer ${secret}`) {
      throw new UnauthorizedException();
    }

    const match = body.path?.match(/^live\/(.+)$/);
    if (!match) return { ok: true };

    const orgSlug = match[1];
    if (body.action === 'publish' || body.action === 'unpublish') {
      await this.org.handleWebhook(orgSlug, body.action);
    }

    return { ok: true };
  }
}
