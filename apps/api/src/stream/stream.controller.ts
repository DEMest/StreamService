import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CreateStreamInput, StreamService, UpdateStreamConfigInput } from './stream.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';

/**
 * Per-Stream API для org_admin.
 *
 * Все endpoint'ы фильтруются по `user.orgId` — попытка доступа к Stream'у чужой
 * орги возвращает 404 (не палим существование).
 *
 * Нет привилегированного «дефолтного» Stream'а — все Stream'ы орги (включая
 * последний) создаются/удаляются через этот контроллер на равных правах.
 */
@Controller('v1/org/streams')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('org_admin')
export class StreamController {
  constructor(private streams: StreamService) {}

  /**
   * GET /v1/org/streams — список Stream'ов орги. Без ingestKey.
   * Возвращает ВСЕ Stream'ы орги (default + все пользовательские).
   */
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.streams.listForOrg(user.orgId!);
  }

  /**
   * POST /v1/org/streams — создать новый Stream внутри орги.
   *
   * Body: { slug, name?, description? }
   *   - slug обязателен, lowercase alphanumeric+dash, не равен '' (зарезервирован).
   *   - name по умолчанию равен slug.
   *
   * Side-effect: создание MediaMTX-пути. При падении MediaMTX — Prisma rollback.
   *
   * Возвращает DTO без ingestKey (как list). 409 если slug дублируется в орге.
   */
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: CreateStreamInput) {
    return this.streams.createForOrg(user.orgId!, body);
  }

  /**
   * DELETE /v1/org/streams/:id — удалить Stream орги (в т.ч. последний).
   *
   * - 404 для cross-tenant.
   * - 409 если Stream сейчас live — сначала нужно остановить трансляцию.
   * - Side-effect: удаление MediaMTX-путей (best-effort). При падении MediaMTX —
   *   log warn, но запись из Prisma всё равно удаляется.
   * - Каскад: Broadcast → Recording удаляются onDelete:Cascade.
   */
  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.streams.deleteForOrg(user.orgId!, id);
  }

  /**
   * GET /v1/org/streams/:id — детали одного Stream'а.
   * `?reveal=true` возвращает ingestKey в DTO (как в /v1/org/me).
   */
  @Get(':id')
  getById(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('reveal') reveal?: string,
  ) {
    return this.streams.getByIdForOrg(user.orgId!, id, reveal === 'true');
  }

  /**
   * GET /v1/org/streams/:id/stats — живая статистика эфира: входящий битрейт,
   * кодеки, состояние транскодера (fps/speed/пропуск кадров), зрители и
   * история за последние ~10 минут для графиков.
   */
  @Get(':id/stats')
  getStats(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.streams.getStatsForOrg(user.orgId!, id);
  }

  /**
   * GET /v1/org/streams/:id/broadcasts — завершённые трансляции Stream'а (tenant-scoped).
   */
  @Get(':id/broadcasts')
  listBroadcasts(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.streams.listBroadcastsForOrg(user.orgId!, id);
  }

  /**
   * PATCH /v1/org/streams/:id — обновить конфигурацию Stream'а.
   *
   * Body поля (все опциональны): name, description, isPublic, previewMode, feedMode.
   *
   * Валидация описана в `StreamService.updateConfig`.
   */
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: UpdateStreamConfigInput,
  ) {
    return this.streams.updateConfig(user.orgId!, id, body);
  }

  /**
   * POST /v1/org/streams/:id/rotate-key — перевыпустить ingestKey (passphrase SRT).
   * Заменяет passphrase на всех MediaMTX-путях Stream'а (`replaceStreamPaths`).
   */
  @Post(':id/rotate-key')
  rotateKey(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.streams.rotateKeyForOrg(user.orgId!, id);
  }

  /**
   * POST /v1/org/streams/:id/stop — принудительно завершить активный Broadcast.
   * MediaMTX push при этом не останавливается (vMix продолжает паблишить);
   * только закрывается Broadcast и сбрасывается isLive.
   * Возвращает `{ alreadyOff: true }` если Stream не в live-состоянии.
   */
  @Post(':id/stop')
  stop(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.streams.forceStop(user.orgId!, id);
  }

  /**
   * PATCH /v1/org/streams/:id/recording — управление записью Stream'а.
   * Body: { enabled?: boolean, mode?: 'auto' | 'manual' } — оба поля
   * опциональны и независимы.
   * - enabled — переключает запись прямо сейчас (patches MediaMTX `record`)
   * - mode — политика автостарта: 'auto' включит запись при publish-webhook'е
   *   если она была выключена; 'manual' оставит как есть, пусть пользователь
   *   рулит кнопкой
   */
  @Patch(':id/recording')
  setRecording(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { enabled?: boolean; mode?: 'auto' | 'manual' },
  ) {
    return this.streams.setRecording(user.orgId!, id, body ?? {});
  }

  /**
   * POST /v1/org/streams/:id/preview — загрузить статичное превью Stream'а
   * (показывается зрителям когда Stream offline).
   */
  @Post(':id/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadPreview(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG and WebP images are allowed');
    }
    return this.streams.uploadPreviewForOrg(user.orgId!, id, file.buffer);
  }

  /**
   * DELETE /v1/org/streams/:id/preview — удалить статичное превью.
   */
  @Delete(':id/preview')
  deletePreview(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.streams.deletePreviewForOrg(user.orgId!, id);
  }

  /**
   * POST /v1/org/streams/:id/chat/clear — очистить чат этого Stream'а.
   */
  @Post(':id/chat/clear')
  clearChat(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.streams.clearChatForOrg(user.orgId!, id);
  }
}
