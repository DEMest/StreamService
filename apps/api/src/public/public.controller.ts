import { Controller, Get, Param, Query } from '@nestjs/common';
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
  getStreamUrl(@Param('orgSlug') orgSlug: string) {
    return this.pub.getStreamUrl(orgSlug);
  }
}
