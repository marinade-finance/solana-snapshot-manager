import { Inject, Injectable } from '@nestjs/common';
import { createPool, createTypeParserPreset, DatabasePool } from 'slonik';
import { ConfigService } from 'src/config/config.service';
import fs from 'fs'

export const batches = function* <T>(items: T[], size: number): Generator<T[]> {
  if (size <= 0) {
    throw new Error('Batch size must be greater than 0');
  }

  for (let i = 0; i < items.length; i += size) {
    yield items.slice(i, i + size);
  }
};

export const PSQL_POOL_PROVIDER = 'PSQL_POOL_PROVIDER';
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

    const sslRootCert = configService.getPgSslRootCert()
    const ssl = sslRootCert ? {
      rejectUnauthorized: true,
      requestCert: true,
      ca: [fs.readFileSync(sslRootCert).toString()],
    } : undefined

    return await createPool(configService.postgresUrl, {
      ssl,
      typeParsers: [
        ...createTypeParserPreset(),
        {
          name: 'timestamptz',
          parse: (timestamp): Date => new Date(timestamp),
        },
        {
          name: 'numeric',
          parse: (numeric): string => numeric,
        },
      ],
      ...statementTimeout,
    });
  },
  inject: [ConfigService],
};

@Injectable()
export class RdsService {
  constructor(@Inject(PSQL_POOL_PROVIDER) public readonly pool: DatabasePool) {}
}
