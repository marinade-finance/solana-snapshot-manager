import { Module } from '@nestjs/common';
import { SnapshotModule } from './snapshot/snapshot.module';
import { RdsModule } from './rds/rds.module';
import { ConfigModule } from './config/config.module';
import { Log4jsModule } from '@nestx-log4js/core';

export const LOG4JS_DEFAULT_LAYOUT = {
  type: 'pattern',
  pattern: '%d{ISO8601} %[%p%] [%15.15x{name}] %m',
  tokens: {
    name: (logEvent: any) => {
      return (logEvent.context && logEvent.context['name']) || '-';
    }
  }
};

const LAYOUT = {
  type: 'pattern',
  pattern: '%d %[[%p]%] %x{singleLine} %x{context}',
  tokens: {
    singleLine: (logEvent: any, ...args: any[]) => {
      console.log(logEvent, args)
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
        '\\n'
      );
    },
  }
}

export const LOG4JS_DEFAULT_CONFIG = {
  appenders: {
    stdout: {
      type: 'stdout',
      layout: LAYOUT,
    },
  },
  categories: {
    default: {
      enableCallStack: true,
      appenders: ['stdout'],
      level: 'info',
    },
  }
};

@Module({
  imports: [SnapshotModule, RdsModule, ConfigModule, Log4jsModule.forRoot({ config: LOG4JS_DEFAULT_CONFIG })],
})
export class AppModule { }
