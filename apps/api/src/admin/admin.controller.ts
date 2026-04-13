import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('superadmin')
export class AdminController {
  constructor(private admin: AdminService) {}

  @Post('orgs')
  createOrg(@Body() body: { slug: string; name: string; password: string }) {
    return this.admin.createOrg(body);
  }

  @Get('orgs')
  listOrgs() {
    return this.admin.listOrgs();
  }

  @Patch('orgs/:slug')
  updateOrg(@Param('slug') slug: string, @Body() body: { name?: string; isActive?: boolean }) {
    return this.admin.updateOrg(slug, body);
  }

  @Delete('orgs/:slug')
  deleteOrg(@Param('slug') slug: string) {
    return this.admin.deleteOrg(slug);
  }
}
