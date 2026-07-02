import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AdminService } from './admin.service';
import { ContactService } from '../contact/contact.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('superadmin')
export class AdminController {
  constructor(
    private admin: AdminService,
    private contact: ContactService,
  ) {}

  @Post('orgs')
  createOrg(@Body() body: { slug: string; password: string }) {
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

  @Get('contact-requests')
  listContactRequests(@Query('status') status?: string) {
    return this.contact.list(status);
  }

  @Patch('contact-requests/:id')
  updateContactRequest(@Param('id') id: string, @Body() body: { status: string }) {
    return this.contact.updateStatus(id, body.status);
  }

  @Delete('contact-requests/:id')
  deleteContactRequest(@Param('id') id: string) {
    return this.contact.remove(id);
  }
}
