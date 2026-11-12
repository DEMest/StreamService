import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from '@prometheus-io/client';

@Injectable()
export class AppService {
  constructor(
    @InjectMetric('hello_worlds_send_total') private readonly helloWorldsCounter: Counter
  ) { }

  getHello(): string {
    this.helloWorldsCounter.inc();

    return 'Hello World!';
  }
}
