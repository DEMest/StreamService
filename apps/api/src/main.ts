import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as cookieParser from 'cookie-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({ origin: true, credentials: true });
  const port = process.env.API_PORT ?? 3001;
  await app.listen(port);
  console.log(`API running on port ${port}`);
}
bootstrap();
