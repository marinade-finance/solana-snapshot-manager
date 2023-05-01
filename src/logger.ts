import { LoggerService } from '@nestjs/common';
import * as log4js from 'log4js';
// import {Config} from './config';

const InternalLoggerFactory = () => {
  log4js.configure({
    appenders: {
      app: {
        type: 'stdout',
        layout: {
          type: 'pattern',
          pattern: '%d %[[%p]%] %x{singleLine}',
          tokens: {
            singleLine: (logEvent: any) => {
              const [msg, ctx] = logEvent.data;
              const err = ctx?.err;
              if (err) {
                ctx.err = undefined;
              }

              const ctxSerialized = ctx ? ` ${JSON.stringify(ctx)}` : '';
              const errSerialized =
                err instanceof Error
                  ? ` <${err.name}: ${err.message}> (${err.stack})`
                  : '';

              return `${msg}${errSerialized}${ctxSerialized}`.replace(
                /\n/g,
                '\\n',
              );
            },
            // context: config.context,
          },
        },
      },
    },
    categories: {
      default: { appenders: ['app'], level: 'DEBUG' },
    },
  });
  return log4js.getLogger();
};

export class Logger implements LoggerService {
  private readonly logger = InternalLoggerFactory();

  log(...args: any[]) {
    this.logger.log('INFO', ...args);
  }
  error(...args: any[]) {
    this.logger.log('ERROR', ...args);
  }
  warn(...args: any[]) {
    this.logger.log('WARN', ...args);
  }
}
