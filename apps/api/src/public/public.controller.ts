import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PublicService } from './public.service';
import { ContactService, CreateContactDto } from '../contact/contact.service';
import { CreateFeedbackDto, FeedbackService } from '../feedback/feedback.service';
import { clientIp } from '../feedback/client-ip';

@Controller('v1/public')
export class PublicController {
  constructor(
    private pub: PublicService,
    private contact: ContactService,
    private feedback: FeedbackService,
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

  /**
   * Обратная связь зрителя (issue #16). Без авторизации: пишет её как раз тот,
   * у кого прямо сейчас что-то не работает, и логин на этом пути — гарантия
   * не получить обращение. Защита от спама живёт в FeedbackService.
   */
  @Post('feedback')
  submitFeedback(@Body() body: CreateFeedbackDto, @Req() req: Request) {
    return this.feedback.create(body, {
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get('orgs')
  getCatalog() {
    return this.pub.getCatalog();
  }

  /** Плоский список всех записей по всем публичным Stream'ам — питает `/archive`. */
  @Get('broadcasts')
  getGlobalArchive() {
    return this.pub.getGlobalArchive();
  }

  /** Картинка организации (S3-прокси) для карточек каталога/архива. */
  @Get('orgs/:orgSlug/image')
  async getOrgImage(@Param('orgSlug') orgSlug: string, @Res() res: Response) {
    const buffer = await this.pub.getOrgImage(orgSlug);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=300',
    });
    res.send(buffer);
  }

  /** GET /v1/public/orgs/:orgSlug — обзор орги (список Stream'ов). */
  @Get('orgs/:orgSlug')
  getOrgOverview(@Param('orgSlug') orgSlug: string) {
    return this.pub.getOrgOverview(orgSlug);
  }

  @Get('orgs/:orgSlug/streams/:streamSlug')
  getOrgWatch(
    @Param('orgSlug') orgSlug: string,
    @Param('streamSlug') streamSlug: string,
    @Query('key') key?: string,
  ) {
    return this.pub.getOrgWatch(orgSlug, streamSlug, key);
  }

  @Get('orgs/:orgSlug/streams/:streamSlug/stream')
  getStreamUrl(
    @Param('orgSlug') orgSlug: string,
    @Param('streamSlug') streamSlug: string,
    @Query('key') key?: string,
  ) {
    return this.pub.getStreamUrl(orgSlug, streamSlug, key);
  }

  @Get('orgs/:orgSlug/streams/:streamSlug/broadcasts')
  getOrgBroadcasts(
    @Param('orgSlug') orgSlug: string,
    @Param('streamSlug') streamSlug: string,
    @Query('key') key?: string,
  ) {
    return this.pub.getOrgBroadcasts(orgSlug, streamSlug, key);
  }

  /**
   * Список broadcast'ов дефолтного Stream'а орги (`slug=''`) — отдельный
   * роут, а не `:streamSlug` с пустым значением: пустой URL-сегмент между
   * двумя `/` не матчится Express'ом. Тело — тот же getOrgBroadcasts('').
   */
  @Get('orgs/:orgSlug/broadcasts')
  getDefaultStreamBroadcasts(
    @Param('orgSlug') orgSlug: string,
    @Query('key') key?: string,
  ) {
    return this.pub.getOrgBroadcasts(orgSlug, '', key);
  }

  /** Превью записи (S3-прокси); для приватного стрима — ?key=<previewKey>. */
  @Get('orgs/:orgSlug/streams/:streamSlug/broadcasts/:broadcastId/preview')
  async getBroadcastPreview(
    @Param('orgSlug') orgSlug: string,
    @Param('streamSlug') streamSlug: string,
    @Param('broadcastId') broadcastId: string,
    @Query('key') key: string | undefined,
    @Res() res: Response,
  ) {
    const buffer = await this.pub.getBroadcastPreview(orgSlug, streamSlug, broadcastId, key);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=300',
    });
    res.send(buffer);
  }

  /** Превью записи дефолтного Stream'а орги (`slug=''`) — см. getDefaultStreamBroadcasts. */
  @Get('orgs/:orgSlug/broadcasts/:broadcastId/preview')
  async getDefaultStreamBroadcastPreview(
    @Param('orgSlug') orgSlug: string,
    @Param('broadcastId') broadcastId: string,
    @Query('key') key: string | undefined,
    @Res() res: Response,
  ) {
    const buffer = await this.pub.getBroadcastPreview(orgSlug, '', broadcastId, key);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=300',
    });
    res.send(buffer);
  }

  @Get('orgs/:orgSlug/streams/:streamSlug/thumbnail')
  async getThumbnail(
    @Param('orgSlug') orgSlug: string,
    @Param('streamSlug') streamSlug: string,
    @Res() res: Response,
  ) {
    const { buffer, maxAge } = await this.pub.getThumbnail(orgSlug, streamSlug);
    res.set({
      'Content-Type': 'image/jpeg',
      'Cache-Control': `public, max-age=${maxAge}`,
    });
    res.send(buffer);
  }
}
