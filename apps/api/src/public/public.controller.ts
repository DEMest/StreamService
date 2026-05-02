import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicService } from './public.service';
import { ContactService, CreateContactDto } from '../contact/contact.service';

@Controller('v1/public')
export class PublicController {
  constructor(
    private pub: PublicService,
    private contact: ContactService,
  ) {}

  @Post('contact')
  submitContact(@Body() body: CreateContactDto) {
    if (!body?.org?.trim() || !body?.name?.trim() || !body?.email?.trim()) {
      throw new BadRequestException('org, name, email are required');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) {
      throw new BadRequestException('Invalid email');
    }
    return this.contact.create(body);
  }

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
