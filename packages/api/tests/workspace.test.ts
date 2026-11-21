import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import request from 'supertest';

import { openPool } from '#src/db/postgres.ts';
import { createApp } from '#src/server.ts';

const pool = openPool('postgres://unused@127.0.0.1:1/unused');
after(() => pool.end());
const app = createApp(pool, '.');

void test('health responds without external services', async () => {
  const response = await request(app).get('/api/health').expect(200);
  assert.deepEqual(response.body, { status: 'ok' });
});

void test('generation rejects empty requirements before calling Ollama', async () => {
  await request(app)
    .post('/api/generation')
    .send({ requirement: '' })
    .expect(422);
});

void test('generation reports Ollama transport failure after one retry', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error('Ollama stopped'));
  try {
    const response = await request(app)
      .post('/api/generation')
      .send({ requirement: 'Create classification workflow policy v1' })
      .expect(503);
    const body = response.body as {
      code: string;
      callCount: number;
      retryCount: number;
      message: string;
    };
    assert.equal(body.code, 'OLLAMA_UNAVAILABLE');
    assert.equal(body.callCount, 2);
    assert.equal(body.retryCount, 1);
    assert.match(body.message, /Ollama stopped/);
  } finally {
    globalThis.fetch = original;
  }
});
