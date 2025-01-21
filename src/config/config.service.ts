import * as dotenv from 'dotenv';
import { Injectable } from '@nestjs/common';

dotenv.config();

const getEnvVar = (key: string) => {
  const val = process.env[key];
  if (!val) {
    throw new Error(`Missing environment variable: ${key}`);
  }
  return val;
};

const getEnvVarOptional = (key: string) => {
  return process.env[key];
};

@Injectable()
export class ConfigService {
  postgresUrl = getEnvVar('POSTGRES_URL');
  rpcUrl = getEnvVar('RPC_URL');

  // Timeout (in milliseconds) after which database is instructed to abort the query.
  // Use 'DISABLE_TIMEOUT' to disable the timeout. (Default for PSQL driver: 60000)
  postgresStatementTimeout = getEnvVarOptional('POSTGRES_STATEMENT_TIMEOUT');

  getPgSslRootCert (): string | undefined {
    return process.env['PG_SSLROOTCERT'];
  }
}
