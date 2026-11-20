import logger from 'jet-logger';

import { Env } from '#src/common/constants/env.constants.ts';

import { migrate } from './migrations.ts';
import { openPool } from './postgres.ts';

if (!Env.DATABASE_URL)
  throw new Error('Set DATABASE_URL before running migrations.');
const pool = openPool(Env.DATABASE_URL);
try {
  await migrate(pool);
  logger.info('PostgreSQL migrations applied.');
} finally {
  await pool.end();
}
