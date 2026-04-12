import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MediamtxModule } from './mediamtx/mediamtx.module';
import { AdminModule } from './admin/admin.module';
import { OrgModule } from './org/org.module';
import { PublicModule } from './public/public.module';

@Module({
  imports: [PrismaModule, AuthModule, MediamtxModule, AdminModule, OrgModule, PublicModule],
  controllers: [HealthController],
})
export class AppModule {}
