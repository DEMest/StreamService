import { Controller, Get, Param } from '@nestjs/common';
import { PublicService } from './public.service';

@Controller('v1/public')
export class PublicController {
  constructor(private pub: PublicService) {}

  @Get('orgs')
  getCatalog() {
    return this.pub.getCatalog();
  }

  @Get('orgs/:orgSlug')
  getOrgWatch(@Param('orgSlug') orgSlug: string) {
    return this.pub.getOrgWatch(orgSlug);
  }

  @Get('orgs/:orgSlug/stream')
  getStreamUrl(@Param('orgSlug') orgSlug: string) {
    return this.pub.getStreamUrl(orgSlug);
  }
}
