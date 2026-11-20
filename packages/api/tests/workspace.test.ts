import assert from 'node:assert/strict';
import { test } from 'node:test';
import request from 'supertest';

import { pp } from '#src/common/constants/Paths/helpers.ts';
import app from '#src/server.ts';

void test('encodes route parameters', () => {
  assert.equal(pp('a b/c'), 'a%20b%2Fc');
});

void test('health responds without external services', async () => {
  const response = await request(app).get('/api/health').expect(200);
  assert.deepEqual(response.body, { status: 'ok' });
});
