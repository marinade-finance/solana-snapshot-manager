import { LoggerService } from '@nestjs/common';

export class Logger implements LoggerService {
  log(...args: any[]) {
    console.log(args);
  }
  error(message: string, trace: string) {
    console.error(message);
  }
  warn(message: string) {
    console.warn(message);
  }
}
