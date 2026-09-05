import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AdsService, AdPlacement, CreateAdDto, UpdateAdDto } from './ads.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

/**
 * Управление рекламными плейсхолдерами — платформенная фича, а не
 * инструмент организации, поэтому только суперадмин (см. capacity.controller.ts).
 */
@Controller('v1/admin/ads')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('superadmin')
export class AdminAdsController {
  constructor(private ads: AdsService) {}

  @Get()
  list() {
    return this.ads.listAdmin();
  }

  @Post()
  create(@Body() body: CreateAdDto) {
    return this.ads.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateAdDto) {
    return this.ads.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ads.remove(id);
  }

  @Get(':id/stats')
  stats(@Param('id') id: string) {
    return this.ads.stats(id);
  }

  @Post(':id/image/:placement')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadImage(
    @Param('id') id: string,
    @Param('placement') placement: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const p = parsePlacement(placement);
    if (!file) throw new BadRequestException('No file uploaded');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG and WebP images are allowed');
    }
    return this.ads.uploadImage(id, p, file.buffer);
  }

  @Delete(':id/image/:placement')
  deleteImage(@Param('id') id: string, @Param('placement') placement: string) {
    return this.ads.deleteImage(id, parsePlacement(placement));
  }
}

function parsePlacement(value: string): AdPlacement {
  if (value !== 'watch' && value !== 'catalog') {
    throw new BadRequestException("placement: 'watch' или 'catalog'");
  }
  return value;
}
