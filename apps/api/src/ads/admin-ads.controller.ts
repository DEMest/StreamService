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
import { CurrentUser } from '../auth/current-user.decorator';
import { AD_MANAGER_ROLE, type JwtPayload } from '../auth/auth.service';

/**
 * Управление рекламными плейсхолдерами — платформенная фича, а не инструмент
 * организации, поэтому org_admin сюда не допущен (см. capacity.controller.ts).
 *
 * Ролей две, а маршрут один, и это не упрощение: суперадмин и рекламный
 * менеджер работают с одним и тем же экраном, но видят на нём разное — кто что,
 * решает AdsService по токену. Развести их по двум контроллерам значило бы
 * поддерживать восемь ручек в двух копиях.
 */
@Controller('v1/admin/ads')
@UseGuards(JwtAuthGuard, RolesGuard)
// Константой, а не литералом: `Roles` объявлен как `(...roles: string[])`, и
// опечатку здесь компилятор не поймает — менеджер молча получил бы 403.
@Roles('superadmin', AD_MANAGER_ROLE)
export class AdminAdsController {
  constructor(private ads: AdsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.ads.listAdmin(user);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: CreateAdDto) {
    return this.ads.create(body, user);
  }

  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: UpdateAdDto) {
    return this.ads.update(id, body, user);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ads.remove(id, user);
  }

  @Get(':id/stats')
  stats(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.ads.stats(id, user);
  }

  // GIF допускаем ради анимированных баннеров (см. AdsService.uploadImage) —
  // такие файлы тяжелее статичных, отсюда лимит выше, чем у превью орги/стрима.
  @Post(':id/image/:placement')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadImage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('placement') placement: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const p = parsePlacement(placement);
    if (!file) throw new BadRequestException('No file uploaded');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, WebP and GIF images are allowed');
    }
    return this.ads.uploadImage(id, p, file.buffer, file.mimetype, user);
  }

  @Delete(':id/image/:placement')
  deleteImage(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('placement') placement: string,
  ) {
    return this.ads.deleteImage(id, parsePlacement(placement), user);
  }
}

function parsePlacement(value: string): AdPlacement {
  if (value !== 'watch' && value !== 'catalog') {
    throw new BadRequestException("placement: 'watch' или 'catalog'");
  }
  return value;
}
