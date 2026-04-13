import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { OrgService } from './org.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';

@Controller('v1/org')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('org_admin')
export class OrgController {
  constructor(private org: OrgService) {}

  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload, @Query('reveal') reveal?: string) {
    return this.org.getProfile(user.orgId!, reveal === 'true');
  }

  @Post('ingest-key/rotate')
  rotateKey(@CurrentUser() user: JwtPayload) {
    return this.org.rotateKey(user.orgId!, user.orgSlug!);
  }

  @Post('events')
  createEvent(
    @CurrentUser() user: JwtPayload,
    @Body() body: { title: string; description?: string; isPublic?: boolean },
  ) {
    return this.org.createEvent(user.orgId!, body);
  }

  @Patch('events/:id')
  updateEvent(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string; isPublic?: boolean; status?: string },
  ) {
    return this.org.updateEvent(user.orgId!, id, body);
  }

  @Get('events')
  listEvents(@CurrentUser() user: JwtPayload) {
    return this.org.listEvents(user.orgId!);
  }

  @Delete('events/:id')
  deleteEvent(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.org.deleteEvent(user.orgId!, id);
  }
}
