import logger from 'jet-logger';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Env } from '#src/common/constants/env.constants.ts';

import { openPool } from './db/postgres.ts';
import { createApp } from './server.ts';

if (!Env.DATABASE_URL)
  throw new Error('Set DATABASE_URL and run the PostgreSQL migrations.');
const pool = openPool(Env.DATABASE_URL);
pool.on('error', (error) => logger.err(error));
const app = createApp(
  pool,
  Env.FILE_STORAGE_DIR ?? join(homedir(), '.local', 'genie'),
);
const server = app.listen(Env.PORT, '127.0.0.1', () => {
  logger.info(`Genie API listening on http://localhost:${Env.PORT}`);
});
server.on('error', (error) => {
  logger.err(error);
  process.exitCode = 1;
  void pool.end();
});
