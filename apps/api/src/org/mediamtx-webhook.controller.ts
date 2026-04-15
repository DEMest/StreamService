import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { OrgService } from './org.service';

@Controller('v1/internal/mediamtx')
export class MediamtxWebhookController {
  constructor(private org: OrgService) {}

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
