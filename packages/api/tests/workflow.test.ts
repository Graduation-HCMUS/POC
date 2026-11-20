import type { WorkflowDraft } from '@packages/contracts';
import { conditionDraftSchema } from '@packages/contracts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { executeCustom } from '#src/workflow/custom.ts';
import { executeWorkflow } from '#src/workflow/execute.ts';
import type { FileStorage } from '#src/workflow/file-operations.ts';
import { parseFile, writeFile } from '#src/workflow/file-operations.ts';
import { validateWorkflow } from '#src/workflow/graph.ts';
import { WorkflowProblem } from '#src/workflow/problems.ts';

import {
  basicWorkflow,
  edge,
  helpdeskOrder,
  helpdeskWorkflow,
  highPort,
  mediumPort,
} from './fixtures/helpdesk.ts';

const id = randomUUID();
const inputFile = {
  fileId: randomUUID(),
  fileName: 'tickets.csv',
  mimeType: 'text/csv',
  sizeBytes: 133,
};
const csv =
  'id,subject,priority,status\n101,"VPN, Wi-Fi",high,open\n102,Printer,low,open\n103,Lockout,high,open\n104,Old,low,closed\n105,Update,medium,open\n';
const storage: FileStorage = {
  read: () => Promise.resolve(Buffer.from(csv)),
  write: (file) =>
    Promise.resolve({
      ...inputFile,
      fileName: file.fileName,
      sizeBytes: file.bytes.length,
      mimeType: 'text/markdown',
    }),
};

function validate(draft: WorkflowDraft) {
  return validateWorkflow({ ...draft, id, version: 1 });
}

function assertIssue(draft: WorkflowDraft, code: string) {
  assert.throws(
    () => validate(draft),
    (error) => error instanceof WorkflowProblem && error.issue.code === code,
  );
}

void test('validates graph constraints and node configuration', () => {
  const invalidPort = structuredClone(helpdeskWorkflow);
  invalidPort.edges.find((item) => item.sourcePort === highPort)!.sourcePort =
    'main';
  assertIssue(invalidPort, 'INVALID_PORT');

  const missingNode = structuredClone(basicWorkflow);
  missingNode.edges[0].target = 'missing';
  assertIssue(missingNode, 'UNKNOWN_NODE');

  const extraTrigger = structuredClone(basicWorkflow);
  extraTrigger.nodes.push({ ...extraTrigger.nodes[0], id: 'other-trigger' });
  assertIssue(extraTrigger, 'TRIGGER_COUNT');

  const cycle = structuredClone(basicWorkflow);
  for (const name of ['x', 'y']) {
    cycle.nodes.push({
      id: name,
      name,
      type: 'custom',
      config: { code: 'return items' },
      position: { x: 0, y: 0 },
    });
  }
  cycle.edges.push(edge('x', 'y'), edge('y', 'x'));
  assertIssue(cycle, 'CYCLE_DETECTED');

  const fanOut = structuredClone(helpdeskWorkflow);
  fanOut.edges.push(edge('trigger', 'normal'));
  assertIssue(fanOut, 'FAN_OUT_NOT_SUPPORTED');

  const multipleIncoming = structuredClone(helpdeskWorkflow);
  multipleIncoming.edges.push(edge('normal', 'read'));
  const normal = multipleIncoming.nodes.find((node) => node.id === 'normal')!;
  normal.type = 'custom';
  normal.config = { code: 'return items' };
  assertIssue(multipleIncoming, 'MULTIPLE_INCOMING');

  const badFunction = structuredClone(helpdeskWorkflow);
  badFunction.nodes.find((item) => item.type === 'custom')!.config = {
    functionName: 'addSummary',
  };
  assertIssue(badFunction, 'LEGACY_NODE_CONFIG');
});

void test('runs Helpdesk FIFO, ignoring canvas coordinates', async () => {
  const moved = structuredClone(helpdeskWorkflow);
  moved.nodes.forEach((node, index) => {
    node.position.x = (moved.nodes.length - index) * 300;
  });
  const result = await executeWorkflow(
    validate(moved),
    [{ json: {}, files: { input: inputFile } }],
    storage,
  );
  assert.equal(result.error, null);
  assert.deepEqual(
    result.nodeRuns.map((log) => log.nodeId),
    helpdeskOrder,
  );
  assert.deepEqual(
    result.nodeRuns.find((log) => log.nodeId === 'priority')?.outputCounts,
    { [highPort]: 2, [mediumPort]: 1, else: 1 },
  );
  const condition = result.nodeRuns.find(
    (log) => log.nodeId === 'priority',
  )?.trace;
  assert.match(condition?.outputs[highPort]?.text ?? '', /"id": "101"/);
  assert.match(condition?.outputs[mediumPort]?.text ?? '', /"id": "105"/);
  assert.match(condition?.outputs.else?.text ?? '', /"id": "102"/);
  assert.doesNotMatch(condition?.outputs.else?.text ?? '', /"id": "103"/);
  const terminal = result.nodeRuns.find(
    (log) => log.nodeId === 'urgent',
  )?.trace;
  assert.equal(terminal?.result?.name, 'urgentFile');
  assert.match(terminal?.result?.data.text ?? '', /"fileName": "urgent.md"/);
  assert.equal(result.outputs.normalTickets[0].json.id, '102');
  assert.equal(
    result.outputs.urgentFile[0].files?.result.fileName,
    'urgent.md',
  );
});

void test('uses the first matching rule and keeps wire IDs when rules move', async () => {
  const draft = structuredClone(helpdeskWorkflow);
  const condition = draft.nodes.find(({ type }) => type === 'condition')!;
  const { branches } = conditionDraftSchema.parse(condition.config);
  branches[1].value = 'high';
  condition.config = { branches };
  const input = [{ json: {}, files: { input: inputFile } }];
  const first = await executeWorkflow(validate(draft), input, storage);
  assert.equal(first.outputs.urgentFile.length, 1);
  assert.equal(first.outputs.mediumTickets, undefined);

  condition.config = { branches: [...branches].reverse() };
  const reordered = await executeWorkflow(validate(draft), input, storage);
  assert.deepEqual(
    reordered.outputs.mediumTickets.map(({ json }) => json.id),
    ['101', '103'],
  );
  assert.equal(reordered.outputs.urgentFile, undefined);
});

void test('limits the UTF-8 trace preview while passing the full payload downstream', async () => {
  const content = 'đ'.repeat(10_000);
  const result = await executeWorkflow(
    validate(basicWorkflow),
    [{ json: { content } }],
    storage,
  );
  const preview = result.nodeRuns[0].trace?.input;
  assert.ok(preview?.truncated);
  assert.ok(Buffer.byteLength(preview.text) <= 16 * 1024);
  assert.doesNotMatch(preview.text, /�/);
  assert.equal(result.outputs.result[0].json.content, content);
});

void test('skips empty branches and reports open ports', async () => {
  const draft = structuredClone(helpdeskWorkflow);
  draft.edges = draft.edges.filter((item) => item.target !== 'normal');
  draft.nodes = draft.nodes.filter((item) => item.id !== 'normal');
  const onlyLow: FileStorage = {
    ...storage,
    read: () =>
      Promise.resolve(
        Buffer.from('id,subject,priority,status\n102,Printer,low,open\n'),
      ),
  };
  const result = await executeWorkflow(
    validate(draft),
    [{ json: {}, files: { input: inputFile } }],
    onlyLow,
  );
  assert.equal(result.error, null);
  assert.deepEqual(
    result.nodeRuns.map((log) => log.nodeId),
    helpdeskOrder.slice(0, 5),
  );
  assert.deepEqual(result.outputs, {});
  assert.equal(result.warnings[0]?.code, 'UNCONNECTED_BRANCH');
});

void test('keeps CSV strings and quoted commas, and keeps MD and TXT in a single item', () => {
  const items = parseFile([{ json: { content: csv } }], 'csv');
  assert.equal(items[0].json.id, '101');
  assert.equal(items[0].json.subject, 'VPN, Wi-Fi');
  for (const format of ['md', 'txt'] as const) {
    const text = '# Title\nOne\nTwo';
    assert.deepEqual(parseFile([{ json: { content: text } }], format), [
      { json: { text } },
    ]);
  }
  assert.throws(
    () =>
      parseFile([{ json: { content: `id\n${'1\n'.repeat(1001)}` } }], 'csv'),
    (error) =>
      error instanceof WorkflowProblem && error.issue.code === 'ITEM_LIMIT',
  );
});

void test('returns useful failure and stops queued nodes', async () => {
  const missingSubject: FileStorage = {
    ...storage,
    read: () =>
      Promise.resolve(
        Buffer.from('id,priority,status\n101,high,open\n102,low,open\n'),
      ),
  };
  const result = await executeWorkflow(
    validate(helpdeskWorkflow),
    [{ json: {}, files: { input: inputFile } }],
    missingSubject,
  );
  assert.deepEqual(
    result.nodeRuns.map((log) => log.nodeId),
    helpdeskOrder.slice(0, 6),
  );
  assert.equal(result.nodeRuns.at(-1)?.status, 'failed');
  assert.equal(result.error?.nodeId, 'summary');
  assert.equal(result.error?.code, 'CUSTOM_EXECUTION');
  assert.match(result.error?.message ?? '', /Expected string id and subject/);
  assert.match(result.nodeRuns.at(-1)?.trace?.input.text ?? '', /"id": "101"/);
  assert.deepEqual(result.outputs, {});
});

void test('Custom exposes only JSON items and stops invalid or unbounded snippets', async () => {
  const signal = AbortSignal.timeout(15_000);
  const input = [{ json: { id: '101' }, files: { input: inputFile } }];
  const result = await executeCustom(
    'return [{ ...items[0], json: { process: typeof process, require: typeof require, fetch: typeof fetch } }]',
    input,
    signal,
  );
  assert.deepEqual(result, [
    {
      json: { process: 'undefined', require: 'undefined', fetch: 'undefined' },
      files: { input: inputFile },
    },
  ]);
  for (const [code, expected] of [
    ['return [', 'CUSTOM_SYNTAX'],
    ['return [{id: "101"}]', 'CUSTOM_OUTPUT'],
    [
      `items[0].files.input.fileId = "${randomUUID()}"; return items`,
      'CUSTOM_OUTPUT',
    ],
    ['while (true) {}', 'CUSTOM_TIMEOUT'],
  ]) {
    await assert.rejects(
      executeCustom(code, input, signal),
      (error) =>
        error instanceof WorkflowProblem && error.issue.code === expected,
    );
  }
});

void test('writes each supported format with one result file reference', async () => {
  const content = new Map<string, string>();
  const destination: FileStorage = {
    ...storage,
    write: (file) => {
      content.set(file.format, file.bytes.toString('utf8'));
      return storage.write(file);
    },
  };
  const items = [{ json: { summary: 'Mạng VPN, Wi-Fi' } }];
  for (const format of ['csv', 'md', 'txt'] as const) {
    const result = await writeFile(
      items,
      format,
      'export',
      destination,
      new AbortController().signal,
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].files?.result.fileName, `export.${format}`);
  }
  assert.equal(content.get('csv'), 'summary\n"Mạng VPN, Wi-Fi"\n');
  assert.equal(content.get('md'), '# Workflow results\n\n- Mạng VPN, Wi-Fi\n');
  assert.equal(content.get('txt'), 'Mạng VPN, Wi-Fi\n');
});
