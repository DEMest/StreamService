import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { TelegramService } from './telegram.service';

@Module({
  providers: [MailService, TelegramService],
  exports: [MailService, TelegramService],
})
export class NotifyModule {}
