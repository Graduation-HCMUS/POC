import {
  draftSchema,
  limits,
  runInputSchema,
  updateSchema,
} from '@packages/contracts';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import logger from 'jet-logger';
import multer from 'multer';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { z } from 'zod';

import { localFileStorage } from './db/file-storage.ts';
import {
  generateWorkflow,
  generationRequestSchema,
} from './generation/generate.ts';
import { WorkflowProblem } from './workflow/problems.ts';
import { workflowService } from './workflow/service.ts';

function parseId(id: string) {
  const parsed = z.uuid().safeParse(id);
  if (parsed.success) return parsed.data;
  throw new WorkflowProblem({ code: 'INVALID_ID', message: 'Use a valid ID.' });
}

const statusByCode: Readonly<Partial<Record<string, number>>> = {
  INVALID_ID: 400,
  GENERATION_BUSY: 409,
  MISSING_UPLOAD: 400,
  VERSION_CONFLICT: 409,
  WORKFLOW_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  FILE_NOT_FOUND: 404,
  FILE_LIMIT: 413,
  UNSUPPORTED_FILE: 415,
};

const handleError: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
  } else if (error instanceof WorkflowProblem) {
    res.status(statusByCode[error.issue.code] ?? 422).json(error.issue);
  } else if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    res.status(422).json({
      code: 'INVALID_REQUEST',
      message: [issue.path.join('.'), issue.message].filter(Boolean).join(': '),
    });
  } else if (error instanceof multer.MulterError) {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    res.status(tooLarge ? 413 : 400).json({
      code: tooLarge ? 'FILE_LIMIT' : 'INVALID_UPLOAD',
      message: tooLarge
        ? 'File exceeds 2 MiB.'
        : 'Upload one file in the file field.',
    });
  } else if (
    error instanceof Error &&
    'status' in error &&
    error.status === 413
  ) {
    res
      .status(413)
      .json({ code: 'BODY_LIMIT', message: 'Request exceeds 2 MiB.' });
  } else if (
    error instanceof SyntaxError &&
    'status' in error &&
    error.status === 400
  ) {
    res.status(400).json({
      code: 'INVALID_JSON',
      message: 'Request body must be valid JSON.',
    });
  } else if (
    error instanceof Error &&
    'code' in error &&
    error.code === 'ENOENT'
  ) {
    res
      .status(404)
      .json({ code: 'FILE_NOT_FOUND', message: 'File was not found.' });
  } else {
    logger.err(error instanceof Error ? error : 'Unexpected API error');
    res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'The API could not complete this request.',
    });
  }
};

export function createApp(pool: Pool, storageDir: string) {
  const app = express();
  const storage = localFileStorage(pool, resolve(storageDir));
  const workflows = workflowService(pool, storage);
  const upload = multer({
    limits: { fileSize: limits.fileBytes + 1, files: 1, fields: 0, parts: 2 },
  });
  app.use(express.json({ limit: limits.outputBytes }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.post('/api/generation', async (req, res) => {
    const { requirement } = generationRequestSchema.parse(req.body);
    const result = await generateWorkflow(requirement);
    const unavailable = result.attempts.every((attempt) => attempt.raw === '');
    res.status(result.workflow ? 200 : unavailable ? 503 : 422).json({
      ...result,
      ...(result.workflow
        ? {}
        : {
            code: unavailable ? 'OLLAMA_UNAVAILABLE' : 'GENERATION_INVALID',
            message: result.attempts.at(-1)!.validationErrors.join('; '),
          }),
    });
  });
  app.get('/api/workflows', async (_req, res) => {
    res.json(await workflows.list());
  });
  app.post('/api/workflows', async (req, res) => {
    res.status(201).json(await workflows.create(draftSchema.parse(req.body)));
  });
  app.get('/api/workflows/:id', async (req, res) => {
    res.json(await workflows.open(parseId(req.params.id)));
  });
  app.put('/api/workflows/:id', async (req, res) => {
    const { version, ...draft } = updateSchema.parse(req.body);
    res.json(await workflows.update(parseId(req.params.id), version, draft));
  });
  app.get('/api/workflows/:id/runs', async (req, res) => {
    res.json(await workflows.listRuns(parseId(req.params.id)));
  });
  app.post('/api/workflows/:id/runs', async (req, res) => {
    const input = runInputSchema.parse(req.body);
    res.status(201).json(await workflows.run(parseId(req.params.id), input));
  });
  app.get('/api/runs/:id', async (req, res) => {
    res.json(await workflows.getRun(parseId(req.params.id)));
  });
  app.post('/api/files', upload.single('file'), async (req, res) => {
    if (!req.file)
      throw new WorkflowProblem({
        code: 'MISSING_UPLOAD',
        message: 'Select a file to upload.',
      });
    res.status(201).json({ fileRef: await storage.upload(req.file) });
  });
  app.get('/api/files/:id', async (req, res, next) => {
    const { metadata, path } = await storage.get(parseId(req.params.id));
    res.download(
      path,
      metadata.fileName,
      {
        dotfiles: 'allow',
        headers: {
          'Content-Type': metadata.mimeType,
          'X-Content-Type-Options': 'nosniff',
        },
      },
      (error) => {
        if (error) next(error);
      },
    );
  });
  app.use((_req, res) => {
    res
      .status(404)
      .json({ code: 'NOT_FOUND', message: 'Endpoint was not found.' });
  });
  app.use(handleError);
  return app;
}
