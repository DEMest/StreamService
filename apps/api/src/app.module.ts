import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MediamtxModule } from './mediamtx/mediamtx.module';

@Module({
  imports: [PrismaModule, AuthModule, MediamtxModule],
  controllers: [HealthController],
})
export class AppModule {}
