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
