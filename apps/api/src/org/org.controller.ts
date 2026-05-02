import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @Patch('stream')
  updateStreamSettings(
    @CurrentUser() user: JwtPayload,
    @Body() body: { streamTitle?: string; streamDescription?: string; streamIsPublic?: boolean; autoStream?: boolean; previewMode?: string; chatTtlMinutes?: number; chatEnabled?: boolean },
  ) {
    if (body.previewMode && !['multicam', 'cam1', 'cam2', 'cam3', 'cam4'].includes(body.previewMode)) {
      throw new BadRequestException('Invalid previewMode. Allowed: multicam, cam1, cam2, cam3, cam4');
    }
    return this.org.updateStreamSettings(user.orgId!, body);
  }


  @Get('broadcasts')
  listBroadcasts(@CurrentUser() user: JwtPayload) {
    return this.org.listBroadcasts(user.orgId!);
  }

  @Patch('broadcasts/:id')
  updateBroadcast(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string },
  ) {
    return this.org.updateBroadcast(user.orgId!, id, body);
  }

  @Delete('broadcasts/:id')
  deleteBroadcast(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.org.deleteBroadcast(user.orgId!, id);
  }

  @Post('chat/clear')
  clearChat(@CurrentUser() user: JwtPayload) {
    return this.org.clearChat(user.orgId!);
  }

  @Post('preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadPreview(@CurrentUser() user: JwtPayload, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG and WebP images are allowed');
    }
    return this.org.uploadPreview(user.orgId!, user.orgSlug!, file.buffer);
  }

  @Delete('preview')
  deletePreview(@CurrentUser() user: JwtPayload) {
    return this.org.deletePreview(user.orgId!, user.orgSlug!);
  }
}
