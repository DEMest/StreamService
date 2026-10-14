import { Module } from '@nestjs/common';
import { RecordingService } from './recording.service';
import { RecordingController } from './recording.controller';
import { LiveAccessCache } from './live-access-cache';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  controllers: [RecordingController],
  providers: [RecordingService, LiveAccessCache],
  exports: [RecordingService, LiveAccessCache],
})
export class RecordingModule {}
