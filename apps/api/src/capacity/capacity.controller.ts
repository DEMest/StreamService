import { Controller, Get, UseGuards } from '@nestjs/common';
import { CapacityService } from './capacity.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

/**
 * Ёмкость сервера — только для суперадмина: это данные о платформе целиком,
 * а не об организации. Тот же вход, что и у остальной админки, отдельного
 * пароля и отдельной панели нет по замыслу.
 */
@Controller('v1/admin/capacity')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('superadmin')
export class CapacityController {
  constructor(private capacity: CapacityService) {}

  @Get()
  getSnapshot() {
    return this.capacity.getSnapshot();
  }
}
