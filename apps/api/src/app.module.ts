import { Module } from "@nestjs/common";
import { HealthController } from "./health/health.controller";
import { EventsModule } from "./events/events.module";

@Module({
  imports: [EventsModule],
  controllers: [HealthController],
})
export class AppModule {}
