import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { makeCounterProvider, PrometheusModule } from '@willsoto/nestjs-prometheus';

@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    makeCounterProvider({
      name: 'hello_worlds_send_total',
      help: 'Общее количество отправленных hello-world\'ов',
    }),
  ],
})
export class AppModule { }
