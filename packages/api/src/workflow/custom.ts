import { dataItemSchema, limits } from '@packages/contracts';
import type { DataItem, FileRef } from '@packages/contracts';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';

import { WorkflowProblem } from './problems.ts';

export type CustomJob = { code: string; input: string };
export type CustomReply =
  { ok: true; output: string } | { ok: false; code: string; message: string };

const workerUrl = new URL('./custom-worker.ts', import.meta.url);

async function invoke(
  job: CustomJob,
  signal: AbortSignal,
): Promise<CustomReply> {
  signal.throwIfAborted();
  const worker = new Worker(workerUrl, {
    workerData: job,
    env: {},
    execArgv: [],
  });
  const workerSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(limits.customWorkerMs),
  ]);
  const workerFailure: CustomReply = {
    ok: false,
    code: 'CUSTOM_EXECUTION',
    message: 'JavaScript worker could not complete.',
  };
  let interrupt = () => {};
  try {
    return await new Promise<CustomReply>((resolve) => {
      interrupt = () =>
        resolve({
          ok: false,
          code: 'CUSTOM_TIMEOUT',
          message: 'JavaScript worker exceeded its time limit.',
        });
      workerSignal.addEventListener('abort', interrupt, { once: true });
      if (workerSignal.aborted) interrupt();
      worker.once('message', (reply: CustomReply) => resolve(reply));
      worker.once('error', () => resolve(workerFailure));
      worker.once('exit', () => resolve(workerFailure));
    });
  } finally {
    workerSignal.removeEventListener('abort', interrupt);
    await worker.terminate();
  }
}

const outputSchema = z.array(dataItemSchema).max(limits.items);
const malformedUnicode = /[\uD800-\uDFFF]/u;

function supportsJsonb(value: unknown): boolean {
  if (typeof value === 'string') {
    return !value.includes('\0') && !malformedUnicode.test(value);
  }
  if (Array.isArray(value)) return value.every(supportsJsonb);
  if (value && typeof value === 'object') {
    return Object.entries(value).every(
      ([key, item]) => supportsJsonb(key) && supportsJsonb(item),
    );
  }
  return true;
}

export async function executeCustom(
  code: string,
  items: DataItem[],
  signal: AbortSignal,
) {
  const input = JSON.stringify(items);
  if (Buffer.byteLength(input) > limits.customDataBytes) {
    throw new WorkflowProblem({
      code: 'CUSTOM_INPUT_LIMIT',
      message: 'Custom input exceeds 2 MiB.',
    });
  }
  const reply = await invoke({ code, input }, signal);
  if (!reply.ok)
    throw new WorkflowProblem({
      code: reply.code,
      message: reply.message
        .replaceAll('\0', '�')
        .replace(/[\uD800-\uDFFF]/gu, '�'),
    });

  const raw: unknown = JSON.parse(reply.output);
  const output = outputSchema.safeParse(raw);
  if (!output.success) {
    throw new WorkflowProblem({
      code: 'CUSTOM_OUTPUT',
      message:
        'Return up to 1,000 items, each with a json object and optional file references.',
    });
  }
  if (!supportsJsonb(output.data)) {
    throw new WorkflowProblem({
      code: 'CUSTOM_OUTPUT',
      message: 'Return UTF-8 JSON without NUL characters.',
    });
  }
  const inputFiles = new Map(
    items
      .flatMap((item) => Object.values(item.files ?? {}))
      .map((file) => [file.fileId, file]),
  );
  return output.data.map((item) => {
    if (!item.files) return item;
    const files = Object.fromEntries(
      Object.entries(item.files).map(([key, ref]): [string, FileRef] => {
        const original = inputFiles.get(ref.fileId);
        if (!original)
          throw new WorkflowProblem({
            code: 'CUSTOM_OUTPUT',
            message: 'Custom can only return file references from its input.',
          });
        return [key, original];
      }),
    );
    return { ...item, files };
  });
}
