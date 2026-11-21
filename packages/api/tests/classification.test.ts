import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { executeWorkflow } from '#src/workflow/execute.ts';
import type { FileStorage } from '#src/workflow/file-operations.ts';
import { validateWorkflow } from '#src/workflow/graph.ts';

import {
  generateWorkflow,
  validateGeneratedWorkflow,
} from '../src/generation/generate.ts';
import {
  classificationCases,
  referenceWorkflow,
} from './fixtures/classification.ts';

void test('reference classifies every acceptance ticket through the real CSV engine', async () => {
  const csv =
    'id,subject,description\n' +
    classificationCases
      .map(({ id, subject, description }) =>
        [id, subject, description].map((s) => JSON.stringify(s)).join(','),
      )
      .join('\n');
  const file = {
    fileId: randomUUID(),
    fileName: 'tickets.csv',
    mimeType: 'text/csv',
    sizeBytes: Buffer.byteLength(csv),
  };
  const storage: FileStorage = {
    read: () => Promise.resolve(Buffer.from(csv)),
    write: () => {
      throw new Error('No writes expected');
    },
  };
  const graph = validateWorkflow({
    ...referenceWorkflow,
    id: randomUUID(),
    version: 1,
  });
  const result = await executeWorkflow(
    graph,
    [{ json: {}, files: { input: file } }],
    storage,
  );
  assert.equal(result.error, null);
  assert.deepEqual(
    result.outputs.classification.map(({ json }) => json),
    classificationCases,
  );
  assert.equal(result.nodeRuns.length, 5);
});

void test('generation rejects invalid ports and operations outside classification scope', () => {
  const broken = structuredClone(referenceWorkflow);
  broken.edges[0].sourcePort = 'else';
  assert.throws(() => validateGeneratedWorkflow(broken), /invalid port/i);
  const routing = structuredClone(referenceWorkflow);
  routing.nodes[1].config = {
    operation: 'write',
    format: 'csv',
    fileName: 'export.csv',
  };
  assert.throws(() => validateGeneratedWorkflow(routing), /unsupported/i);
});

void test('reference marks a CSV missing the description column for manual review', async () => {
  const graph = validateWorkflow({
    ...referenceWorkflow,
    id: randomUUID(),
    version: 1,
  });
  const file = {
    fileId: randomUUID(),
    fileName: 'bad.csv',
    mimeType: 'text/csv',
    sizeBytes: 23,
  };
  const storage: FileStorage = {
    read: () => Promise.resolve(Buffer.from('id,subject\n11,refund\n')),
    write: () => {
      throw new Error('No writes expected');
    },
  };
  const result = await executeWorkflow(
    graph,
    [{ json: {}, files: { input: file } }],
    storage,
  );
  assert.equal(result.error, null);
  assert.deepEqual(result.outputs.classification[0].json, {
    id: '11',
    subject: 'refund',
    category: 'manual_review',
    manual_review: true,
    reason: 'invalid_input',
    matched_categories: [],
  });
});

void test('transport unit double: retries once and preserves the failed first attempt', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    if (calls === 1) return Promise.reject(new Error('connection stopped'));
    return Promise.resolve(
      Response.json({
        message: { content: JSON.stringify(referenceWorkflow) },
        done: true,
        done_reason: 'stop',
      }),
    );
  };
  try {
    const result = await generateWorkflow('Generate policy v1 classification');
    assert.equal(calls, 2);
    assert.equal(result.retryCount, 1);
    assert.equal(result.repairCount, 0);
    assert.match(result.attempts[0].validationErrors[0], /connection stopped/);
    assert.ok(result.workflow);
  } finally {
    globalThis.fetch = original;
  }
});

void test('transport unit double: invalid output gets at most one repair and no reference fallback', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls++;
    return Promise.resolve(
      Response.json({
        message: { content: '{' },
        done: true,
        done_reason: 'stop',
      }),
    );
  };
  try {
    const result = await generateWorkflow('Generate policy v1 classification');
    assert.equal(calls, 2);
    assert.equal(result.repairCount, 1);
    assert.equal(result.workflow, null);
    assert.equal(result.attempts.length, 2);
  } finally {
    globalThis.fetch = original;
  }
});
