import { Module } from '@nestjs/common';
import { StudioGateway } from './studio.gateway';
import { AuthModule } from '../auth/auth.module';
import { StreamModule } from '../stream/stream.module';

@Module({
  imports: [AuthModule, StreamModule],
  providers: [StudioGateway],
  exports: [StudioGateway],
})
export class StudioModule {}
