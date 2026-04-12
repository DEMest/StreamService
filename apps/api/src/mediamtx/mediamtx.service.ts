import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class MediamtxService {
  private readonly logger = new Logger(MediamtxService.name);
  private readonly base = process.env.MEDIAMTX_API_URL ?? 'http://localhost:9997';

  async addPath(orgSlug: string, passphrase: string): Promise<void> {
    try {
      await axios.post(`${this.base}/v3/config/paths/add/live/${orgSlug}`, {
        srtPublishPassphrase: passphrase,
      });
    } catch (err: any) {
      this.logger.warn(`MediaMTX addPath failed for ${orgSlug}: ${err.message}`);
    }
  }

  async patchPath(orgSlug: string, passphrase: string): Promise<void> {
    try {
      await axios.patch(`${this.base}/v3/config/paths/patch/live/${orgSlug}`, {
        srtPublishPassphrase: passphrase,
      });
    } catch (err: any) {
      this.logger.warn(`MediaMTX patchPath failed for ${orgSlug}: ${err.message}`);
    }
  }

  async deletePath(orgSlug: string): Promise<void> {
    try {
      await axios.delete(`${this.base}/v3/config/paths/delete/live/${orgSlug}`);
    } catch (err: any) {
      this.logger.warn(`MediaMTX deletePath failed for ${orgSlug}: ${err.message}`);
    }
  }
}
