import logger from 'jet-logger';

import { Env } from '#src/common/constants/env.constants.ts';

import app from './server.ts';

const server = app.listen(Env.PORT, () => {
  logger.info(`Genie API listening on http://localhost:${Env.PORT}`);
});
server.on('error', (error) => {
  logger.err(error);
  process.exitCode = 1;
});
