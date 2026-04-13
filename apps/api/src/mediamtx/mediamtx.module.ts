import { Global, Module } from '@nestjs/common';
import { MediamtxService } from './mediamtx.service';

@Global()
@Module({
  providers: [MediamtxService],
  exports: [MediamtxService],
})
export class MediamtxModule {}
