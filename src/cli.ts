import { NestFactory } from '@nestjs/core';
import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';
import { CliModule } from './cli/cli.module';
import { Log4jsLogger } from '@nestx-log4js/core';
import { Logger } from './logger';

async function bootstrap() {
  // const app = await NestFactory.create(AppModule, );
  // app.useLogger(app.get(Log4jsLogger));
  await CommandFactory.run(CliModule, new Logger());
}

bootstrap();
