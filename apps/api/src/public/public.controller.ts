import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicService } from './public.service';

@Controller('v1/public')
export class PublicController {
  constructor(private pub: PublicService) {}

  @Get('orgs')
  getCatalog() {
    return this.pub.getCatalog();
  }

  @Get('orgs/:orgSlug')
  getOrgWatch(@Param('orgSlug') orgSlug: string, @Query('key') key?: string) {
    return this.pub.getOrgWatch(orgSlug, key);
  }

  @Get('orgs/:orgSlug/stream')
  getStreamUrl(@Param('orgSlug') orgSlug: string, @Query('key') key?: string) {
    return this.pub.getStreamUrl(orgSlug, key);
  }

  @Get('orgs/:orgSlug/broadcasts')
  getOrgBroadcasts(@Param('orgSlug') orgSlug: string, @Query('key') key?: string) {
    return this.pub.getOrgBroadcasts(orgSlug, key);
  }

  @Get('orgs/:orgSlug/thumbnail')
  async getThumbnail(@Param('orgSlug') orgSlug: string, @Res() res: Response) {
    const { buffer, maxAge } = await this.pub.getThumbnail(orgSlug);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': `public, max-age=${maxAge}`,
    });
    res.send(buffer);
  }
}
