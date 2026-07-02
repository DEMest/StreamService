import { Body, Controller, Headers, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { StreamService } from '../stream/stream.service';

@Controller('v1/internal/mediamtx')
export class MediamtxWebhookController {
  private readonly logger = new Logger(MediamtxWebhookController.name);

  constructor(private stream: StreamService) {}

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
    if (body.action !== 'publish') return { ok: true };

    if (body.protocol === 'srt') return { ok: true };

    const segments = body.path?.match(/^live\/(.+)$/)?.[1]?.split('/').filter((s) => s.length > 0);
    if (!segments || segments.length === 0) {
      this.logger.warn(`Auth rejected: invalid path "${body.path}" from ${body.ip}`);
      throw new UnauthorizedException('Invalid path');
    }
    const orgSlug = segments[0];
    const streamSlug = segments.slice(1).join('/');

    const params = new URLSearchParams(body.query ?? '');
    const key = params.get('key') || body.password;
    const pathLabel = `"${orgSlug}/${streamSlug}"`;
    if (!key) {
      this.logger.warn(`RTMP auth rejected for ${pathLabel}: no key (${body.ip})`);
      throw new UnauthorizedException('No key provided');
    }

    const valid = await this.stream.verifyIngestKey(orgSlug, streamSlug, key);
    if (!valid) {
      this.logger.warn(`RTMP auth rejected for ${pathLabel}: invalid key (${body.ip})`);
      throw new UnauthorizedException('Invalid key');
    }

    this.logger.log(`RTMP auth accepted for ${pathLabel} (${body.ip})`);
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

    if (body.action === 'publish' || body.action === 'unpublish') {
      await this.stream.handleWebhook(body.path, body.action);
    }

    return { ok: true };
  }
}
