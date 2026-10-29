import { Inject, Injectable } from '@nestjs/common';
import { createPool, createTypeParserPreset, DatabasePool } from 'slonik';
import { ConfigService } from 'src/config/config.service';
import fs from 'fs';
import { withCheckoutTimeout } from './pool-checkout';

export const batches = function* <T>(items: T[], size: number): Generator<T[]> {
  if (size <= 0) {
    throw new Error('Batch size must be greater than 0');
  }

  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
};

export const PSQL_POOL_PROVIDER = 'PSQL_POOL_PROVIDER';
const MAX_POOL_SIZE = 10;
// what pg-pool's connectionTimeoutMillis bounded a checkout to under slonik 33
const CHECKOUT_TIMEOUT_MS = 5_000;
export const typeParsers = [
  ...createTypeParserPreset(),
  {
    name: 'timestamptz',
    parse: (timestamp: string): Date => new Date(timestamp),
  },
  {
    name: 'numeric',
    parse: (numeric: string): string => numeric,
  },
];
export const poolFactory = {
  provide: PSQL_POOL_PROVIDER,
  useFactory: async (configService: ConfigService) => {
    let statementTimeout = {};
    if (configService.postgresStatementTimeout != null) {
      // not-null not-undefined
      statementTimeout = {
        statementTimeout:
          configService.postgresStatementTimeout === 'DISABLE_TIMEOUT'
            ? 'DISABLE_TIMEOUT'
            : parseInt(configService.postgresStatementTimeout, 10),
      };
    }

    const sslRootCert = configService.getPgSslRootCert();
    const ssl = sslRootCert
      ? {
          rejectUnauthorized: true,
          requestCert: true,
          ca: [fs.readFileSync(sslRootCert).toString()],
        }
      : undefined;

    const pool = await createPool(configService.postgresUrl, {
      maxPoolSize: MAX_POOL_SIZE,
      ssl,
      typeParsers,
      ...statementTimeout,
    });
    return withCheckoutTimeout(pool, MAX_POOL_SIZE, CHECKOUT_TIMEOUT_MS);
  },
  inject: [ConfigService],
};

@Injectable()
export class RdsService {
  constructor(@Inject(PSQL_POOL_PROVIDER) public readonly pool: DatabasePool) {}
}
