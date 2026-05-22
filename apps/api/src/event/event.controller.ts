import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  CreateEventInput,
  EventService,
  UpdateEventInput,
} from './event.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';

/**
 * Event API для org_admin (Step 5).
 *
 * Все endpoint'ы tenant-фильтруются по `user.orgId` — попытка доступа к
 * Event'у чужой орги возвращает 404 (не палим существование).
 *
 * См. spec §9 «Event и чат», §12 «Viewer UX Catalog».
 */
@Controller('v1/org/events')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('org_admin')
export class EventController {
  constructor(private events: EventService) {}

  /** GET /v1/org/events — список Event'ов орги (без вложенных streams[]). */
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.events.list(user.orgId!);
  }

  /**
   * GET /v1/org/events/:id — детали + streams[] (полный список привязанных
   * Stream'ов с краткой инфой о каждом).
   */
  @Get(':id')
  getById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.events.get(user.orgId!, id);
  }

  /**
   * POST /v1/org/events — создать Event.
   * Body: `{ slug, title, description?, scheduledAt? }`.
   * 409 при дубликате slug в орге.
   */
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: CreateEventInput) {
    return this.events.create(user.orgId!, body);
  }

  /**
   * PATCH /v1/org/events/:id — обновить title/description/scheduledAt.
   * slug менять не даём (стабильный публичный URL).
   */
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: UpdateEventInput,
  ) {
    return this.events.update(user.orgId!, id, body);
  }

  /**
   * DELETE /v1/org/events/:id — удалить Event.
   * Каскад: EventStream → cascade, ChatMessage(eventId) → cascade,
   * Broadcast.eventId → set null (см. EventService.delete).
   */
  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.events.delete(user.orgId!, id);
  }

  /**
   * POST /v1/org/events/:id/start — перевести в активное состояние
   * (startedAt = NOW).
   */
  @Post(':id/start')
  start(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.events.start(user.orgId!, id);
  }

  /**
   * POST /v1/org/events/:id/end — завершить Event (endedAt = NOW).
   */
  @Post(':id/end')
  end(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.events.end(user.orgId!, id);
  }

  /**
   * POST /v1/org/events/:id/streams — привязать Stream к Event'у.
   * Body: `{ streamId }`. Stream обязан принадлежать орге caller'а; иначе 404.
   * Идемпотентно — повторное добавление не падает.
   */
  @Post(':id/streams')
  addStream(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { streamId: string },
  ) {
    return this.events.addStream(user.orgId!, id, body?.streamId);
  }

  /**
   * DELETE /v1/org/events/:id/streams/:streamId — отвязать Stream от Event'а.
   * Идемпотентно — отсутствие связи не падает.
   */
  @Delete(':id/streams/:streamId')
  @HttpCode(200)
  removeStream(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('streamId') streamId: string,
  ) {
    return this.events.removeStream(user.orgId!, id, streamId);
  }
}
