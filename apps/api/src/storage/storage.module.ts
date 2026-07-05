import { Module } from '@nestjs/common';
import { S3Service } from './s3.service';
import { ImageService } from './image.service';

@Module({
  providers: [S3Service, ImageService],
  exports: [S3Service, ImageService],
})
export class StorageModule {}
