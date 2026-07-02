import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { OrgService } from './org.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtPayload } from '../auth/auth.service';
import { ALLOWED_CHAT_TTL_MINUTES } from '../chat/chat.service';
import { BadRequestException } from '@nestjs/common';

/**
 * Org-уровневые операции: профиль (для orgSlug/orgName), настройки чата
 * (chatTtlMinutes/chatEnabled — они живут на Organization, не на Stream),
 * и broadcast-мутации (update/delete по broadcastId, tenant-scoped через
 * принадлежность Stream'у этой орги — не через какой-то один «главный» Stream).
 * Всё stream-специфичное (ingest, recording, preview, per-stream chat-clear)
 * живёт на StreamController (`/v1/org/streams/:id/...`).
 */
@Controller('v1/org')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('org_admin')
export class OrgController {
  constructor(private org: OrgService) {}

  /**
   * GET /v1/org/me — идентичность орги (slug/name/chat-настройки).
   * НЕ содержит stream-полей — для деталей конкретного Stream'а используйте
   * GET /v1/org/streams/:id.
   */
  @Get('me')
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.org.getProfile(user.orgId!);
  }

  /**
   * PATCH /v1/org/settings — отображаемое имя орги + настройки чата.
   * `name` уникально в БД (409 при занятом имени).
   */
  @Patch('settings')
  updateSettings(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name?: string; chatTtlMinutes?: number; chatEnabled?: boolean },
  ) {
    if (body.name !== undefined && body.name.trim().length === 0) {
      throw new BadRequestException('name must not be empty');
    }
    if (body.chatTtlMinutes !== undefined && !ALLOWED_CHAT_TTL_MINUTES.includes(body.chatTtlMinutes as any)) {
      throw new BadRequestException(`Invalid chatTtlMinutes. Allowed: ${ALLOWED_CHAT_TTL_MINUTES.join(', ')}`);
    }
    return this.org.updateSettings(user.orgId!, body);
  }

  /**
   * PATCH /v1/org/broadcasts/:id — переименовать/описать broadcast.
   * Tenant-scope: broadcast должен принадлежать какому-то Stream'у этой орги
   * (не привязано к конкретному Stream'у в URL — broadcastId уже уникален).
   */
  @Patch('broadcasts/:id')
  updateBroadcast(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { title?: string; description?: string },
  ) {
    return this.org.updateBroadcast(user.orgId!, id, body);
  }

  /**
   * DELETE /v1/org/broadcasts/:id — удалить broadcast (+ его recording).
   */
  @Delete('broadcasts/:id')
  deleteBroadcast(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.org.deleteBroadcast(user.orgId!, id);
  }
}
