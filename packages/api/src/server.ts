import express from 'express';
import type { ErrorRequestHandler } from 'express';

import { RouteError } from '#src/common/classes/route-errors.ts';
import Paths from '#src/common/constants/Paths/index.ts';

import apiRouter from './routers/api.router.ts';

const app = express();
app.use(express.json());
app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});
app.use(Paths.PATH, apiRouter);

const handleError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof RouteError) {
    res.status(err.status).json({ error: err.message, errors: err.errors });
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
};
app.use(handleError);

export default app;
