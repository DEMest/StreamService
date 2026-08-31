import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CapacityService } from './capacity.service';
import { CapacityAlertsService } from './capacity-alerts.service';
import { CapacityPeriod, CapacitySnapshot } from './capacity.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

/**
 * Ёмкость сервера — только для суперадмина: это данные о платформе целиком, а
 * не об организации. Тот же вход, что и у остальной админки; отдельного пароля
 * и отдельной панели нет по замыслу.
 */
@Controller('v1/admin/capacity')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('superadmin')
export class CapacityController {
  constructor(
    private capacity: CapacityService,
    /**
     * Инциденты подмешиваются здесь, а не внутри CapacityService: сервис
     * тревог сам зависит от него, и обратная связь замкнула бы граф.
     */
    private alerts: CapacityAlertsService,
  ) {}

  /**
   * @param period час (из памяти) | сутки | неделя (из базы)
   * @param streamKey `<orgSlug>/<streamSlug>` — фильтр по одному эфиру
   */
  @Get()
  async getSnapshot(
    @Query('period') period?: string,
    @Query('streamKey') streamKey?: string,
  ): Promise<CapacitySnapshot> {
    const snapshot = await this.capacity.getSnapshotFor(normalizePeriod(period), streamKey || undefined);
    // На стенде лента синтетическая — подменять её пустой базой незачем.
    if (snapshot.demo) return snapshot;

    return { ...snapshot, incidents: await this.alerts.recent() };
  }
}

/** Неизвестное значение — час: экран должен открыться, а не отдать ошибку. */
function normalizePeriod(raw?: string): CapacityPeriod {
  return raw === 'day' || raw === 'week' ? raw : 'hour';
}
