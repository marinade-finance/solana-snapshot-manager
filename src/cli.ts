import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli/cli.module';
import { Logger } from './logger';

async function bootstrap() {
  await CommandFactory.run(CliModule, new Logger());
}

bootstrap();
