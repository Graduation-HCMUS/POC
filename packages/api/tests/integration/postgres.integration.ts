/* eslint-disable no-process-env */
import { limits } from '@packages/contracts';
import type {
  FileRef,
  RunResult,
  WorkflowDefinition,
} from '@packages/contracts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import request from 'supertest';

import { migrate } from '#src/db/migrations.ts';
import { openPool } from '#src/db/postgres.ts';
import { createApp } from '#src/server.ts';

import {
  basicWorkflow,
  helpdeskOrder,
  helpdeskWorkflow,
} from '../fixtures/helpdesk.ts';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl)
  throw new Error(
    'Set TEST_DATABASE_URL to the dedicated PostgreSQL test database.',
  );
const schema = `test_${randomUUID().replaceAll('-', '')}`;
const admin = openPool(testUrl);
const url = new URL(testUrl);
url.searchParams.set('options', `-c search_path=${schema}`);
const pool = openPool(url.href);
const storageDir = await mkdtemp(join(tmpdir(), 'genie-test-'));
const app = request(createApp(pool, storageDir));

before(async () => {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await migrate(pool);
  await migrate(pool);
});

after(async () => {
  try {
    await pool.end();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await admin.end();
    await rm(storageDir, { recursive: true, force: true });
  }
});

void test('saves drafts and snapshots the executed version using PostgreSQL', async () => {
  const empty = { name: 'Draft canvas', nodes: [], edges: [] };
  const created = (await app.post('/api/workflows').send(empty).expect(201))
    .body as WorkflowDefinition;
  const path = `/api/workflows/${created.id}`;
  await app.get(path).expect(200, created);
  const missingId = randomUUID();
  await app
    .post(`${path}/runs`)
    .send({ fileId: missingId, version: 1 })
    .expect(422, {
      code: 'TRIGGER_COUNT',
      message: 'Add exactly one Trigger node.',
    });
  await app.get(`${path}/runs`).expect(200, []);
  const draft = structuredClone(basicWorkflow);
  draft.nodes[0].position = { x: 24, y: 77 };
  const ready = (
    await app
      .put(path)
      .send({ ...draft, version: 1 })
      .expect(200)
  ).body as WorkflowDefinition;
  assert.equal(ready.version, 2);
  await app.get(path).expect(200, ready);
  await app
    .put(path)
    .send({ ...draft, version: 1 })
    .expect(409);
  await app
    .post(`${path}/runs`)
    .send({ fileId: missingId, version: 1 })
    .expect(409);
  await app
    .post(`${path}/runs`)
    .send({ fileId: missingId, version: 2 })
    .expect(404);
  const uploaded = (
    await app
      .post('/api/files')
      .attach('file', Buffer.from('test'), 'demo.txt')
      .expect(201)
  ).body as { fileRef: FileRef };

  const result = (
    await app
      .post(`${path}/runs`)
      .send({ fileId: uploaded.fileRef.fileId, version: 2 })
      .expect(201)
  ).body as RunResult;
  assert.equal(result.status, 'success');
  assert.deepEqual(result.outputs.result, [
    { json: {}, files: { input: uploaded.fileRef } },
  ]);
  await app
    .put(path)
    .send({ ...draft, name: 'Changed later', version: 2 })
    .expect(200);
  const persisted = (await app.get(`/api/runs/${result.id}`).expect(200))
    .body as RunResult;
  assert.deepEqual(persisted, result);
  assert.deepEqual(persisted.workflowSnapshot, ready);
  const history: unknown = (await app.get(`${path}/runs`).expect(200)).body;
  assert.ok(Array.isArray(history) && history.length === 1);
});

void test('processes a real upload, stores node logs, downloads output, and records failures', async () => {
  const csv = await readFile(
    new URL('../fixtures/tickets.csv', import.meta.url),
  );
  const uploaded = (
    await app
      .post('/api/files')
      .attach('file', csv, { filename: 'tickets.csv', contentType: 'text/csv' })
      .expect(201)
  ).body as { fileRef: FileRef };
  await app
    .get(`/api/files/${uploaded.fileRef.fileId}`)
    .expect(200, csv.toString());
  const workflow = (
    await app.post('/api/workflows').send(helpdeskWorkflow).expect(201)
  ).body as WorkflowDefinition;
  const path = `/api/workflows/${workflow.id}/runs`;
  const result = (
    await app
      .post(path)
      .send({
        version: 1,
        fileId: uploaded.fileRef.fileId,
      })
      .expect(201)
  ).body as RunResult;
  assert.equal(result.status, 'success');
  assert.deepEqual(
    result.nodeRuns.map((node) => node.nodeId),
    helpdeskOrder,
  );
  assert.deepEqual(
    result.outputs.normalTickets.map((item) => item.json.id),
    ['102'],
  );
  assert.deepEqual(
    result.outputs.mediumTickets.map(({ json }) => json.id),
    ['105'],
  );
  const fileId = result.outputs.urgentFile[0].files?.result.fileId;
  assert.ok(fileId);
  const download = await app
    .get(`/api/files/${fileId}`)
    .expect('Content-Disposition', /urgent\.md/)
    .expect(200);
  assert.match(download.text, /101.*VPN, Wi-Fi/);
  assert.match(download.text, /103.*Account lockout/);
  assert.doesNotMatch(download.text, /102|104|105/);
  assert.deepEqual(
    (await app.get(`/api/runs/${result.id}`).expect(200)).body,
    result,
  );

  const broken = structuredClone(helpdeskWorkflow);
  broken.nodes.find(({ type }) => type === 'custom')!.config = {
    code: 'return false',
  };
  await app
    .put(`/api/workflows/${workflow.id}`)
    .send({ ...broken, version: 1 })
    .expect(200);
  const failed = (
    await app
      .post(path)
      .send({ version: 2, fileId: uploaded.fileRef.fileId })
      .expect(201)
  ).body as RunResult;
  assert.equal(failed.status, 'failed');
  assert.deepEqual(
    failed.nodeRuns.map((node) => node.nodeId),
    helpdeskOrder.slice(0, 6),
  );
  assert.equal(failed.error?.code, 'CUSTOM_OUTPUT');
  assert.deepEqual(
    (await app.get(`/api/runs/${failed.id}`).expect(200)).body,
    failed,
  );
  await app.post('/api/files').attach('file', csv, 'tickets.exe').expect(415);
  await app
    .post('/api/files')
    .attach('file', Buffer.alloc(limits.fileBytes + 5, 'a'), 'large.txt')
    .expect(413);
  await app
    .post('/api/files')
    .attach('file', Buffer.from([255]), 'bad.txt')
    .expect(422);
});
