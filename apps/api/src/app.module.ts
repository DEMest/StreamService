import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MediamtxModule } from './mediamtx/mediamtx.module';
import { AdminModule } from './admin/admin.module';
import { OrgModule } from './org/org.module';
import { PublicModule } from './public/public.module';
import { ChatModule } from './chat/chat.module';
import { RecordingModule } from './recording/recording.module';
import { ThumbnailModule } from './thumbnail/thumbnail.module';
import { StreamModule } from './stream/stream.module';
import { StatsModule } from './stats/stats.module';
import { SeoModule } from './seo/seo.module';
import { SearchModule } from './search/search.module';
import { CapacityModule } from './capacity/capacity.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    MediamtxModule,
    AdminModule,
    OrgModule,
    PublicModule,
    ChatModule,
    RecordingModule,
    ThumbnailModule,
    StreamModule,
    StatsModule,
    SeoModule,
    SearchModule,
    CapacityModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
