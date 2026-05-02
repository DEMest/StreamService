import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { ContactModule } from '../contact/contact.module';

@Module({
  imports: [AuthModule, ContactModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
