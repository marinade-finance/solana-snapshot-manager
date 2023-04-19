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

@Injectable()
export class ConfigService {
  postgresUrl = getEnvVar('POSTGRES_URL');
}
