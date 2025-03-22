import { CommandFactory } from 'nest-commander';
import { CliModule } from './cli/cli.module';
import { Logger } from './logger';

async function bootstrap() {
  await CommandFactory.run(CliModule, {
    logger: new Logger(),
    errorHandler: (err) => {
      console.error('Error handler:', err);
      process.exit(1);
    },
    serviceErrorHandler: (err) => {
      console.error('Service error:', err);
      process.exit(2);
    },
  });
}

bootstrap();