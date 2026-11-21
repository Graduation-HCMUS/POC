import type { WorkflowDraft } from '@packages/contracts';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { requirements } from '../src/generation/domain.ts';
import { generateWorkflow, model } from '../src/generation/generate.ts';
import { executeWorkflow } from '../src/workflow/execute.ts';
import type { FileStorage } from '../src/workflow/file-operations.ts';
import { validateWorkflow } from '../src/workflow/graph.ts';
import {
  classificationCases,
  referenceWorkflow,
} from './fixtures/classification.ts';

const destination = process.argv[2];
if (!destination)
  throw new Error(
    'Pass a NEW output directory, e.g. /tmp/classification-run-1',
  );
const directory = resolve(destination);
// Refuse to overwrite a previous experiment, including its locked expectations.
await mkdir(directory);
async function save(name: string, value: unknown) {
  await writeFile(
    resolve(directory, name),
    JSON.stringify(value, null, 2) + '\n',
  );
}
const csv =
  'id,subject,description\n' +
  classificationCases
    .map(({ id, subject, description }) =>
      [id, subject, description].map((s) => JSON.stringify(s)).join(','),
    )
    .join('\n') +
  '\n';
await writeFile(resolve(directory, 'tickets.csv'), csv);
await save('test-cases.json', classificationCases);
await save('reference-workflow.json', referenceWorkflow);
await save('oracle-lock.json', {
  createdAt: new Date().toISOString(),
  sha256: createHash('sha256')
    .update(JSON.stringify(classificationCases))
    .digest('hex'),
});
const file = {
  fileId: randomUUID(),
  fileName: 'tickets.csv',
  mimeType: 'text/csv',
  sizeBytes: Buffer.byteLength(csv),
};
const storage: FileStorage = {
  read: () => readFile(resolve(directory, 'tickets.csv')),
  write: () => {
    throw new Error('Classification must not write files');
  },
};

async function evaluate(draft: WorkflowDraft) {
  const started = performance.now();
  const result = await executeWorkflow(
    validateWorkflow({ ...draft, id: randomUUID(), version: 1 }),
    [{ json: {}, files: { input: file } }],
    storage,
  );
  const actual = result.outputs.classification ?? [];
  const cases = classificationCases.map((expected) => {
    const rows = actual.filter(({ json }) => json.id === expected.id);
    const observed = rows[0]?.json ?? null;
    const pass =
      rows.length === 1 &&
      observed !== null &&
      Object.entries(expected).every(
        ([key, value]) =>
          JSON.stringify(observed[key]) === JSON.stringify(value),
      );
    return { id: expected.id, expected, actual: observed, pass };
  });
  const passed = cases.filter((c) => c.pass).length;
  const labelCorrect = cases.filter(
    (c) => c.actual?.category === c.expected.category,
  ).length;
  return {
    passed,
    total: cases.length,
    accuracy: labelCorrect / cases.length,
    requirementSatisfiedOnAcceptanceSuite:
      !result.error &&
      !result.warnings.length &&
      actual.length === cases.length &&
      passed === cases.length,
    latencyMs: Math.round(performance.now() - started),
    cases,
    ...result,
  };
}

const reference = await evaluate(referenceWorkflow);
await save('reference-evaluation.json', reference);
if (!reference.requirementSatisfiedOnAcceptanceSuite)
  throw new Error('Reference failed; generation must not start.');
const results: Record<string, unknown> = { reference };
if (!process.argv.includes('--reference-only')) {
  const environment: Record<string, unknown> = {
    checkedAt: new Date().toISOString(),
    model,
  };
  for (const path of ['version', 'tags', 'ps']) {
    const response = await fetch(`http://127.0.0.1:11434/api/${path}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Ollama ${path} HTTP ${response.status}`);
    environment[path] = await response.json();
  }
  await save('environment.json', environment);
  for (const language of ['en', 'vi'] as const) {
    await save(`${language}-started.json`, {
      startedAt: new Date().toISOString(),
      requirement: requirements[language],
    });
    try {
      const generation = await generateWorkflow(requirements[language]);
      await save(`${language}-generation.json`, generation);
      const evaluation = generation.workflow
        ? await evaluate(generation.workflow)
        : null;
      await save(`${language}-evaluation.json`, evaluation);
      results[language] = { valid: !!generation.workflow, evaluation };
      if (!evaluation?.requirementSatisfiedOnAcceptanceSuite)
        process.exitCode = 1;
    } catch (error) {
      results[language] = {
        error: error instanceof Error ? error.message : String(error),
      };
      await save(`${language}-failure.json`, results[language]);
      process.exitCode = 1;
    }
    await save('evaluation-results.json', results);
  }
}
await save('evaluation-results.json', results);
process.stdout.write(
  JSON.stringify({
    directory,
    reference: `${reference.passed}/${reference.total}`,
    status: process.exitCode ? 'FAIL' : 'PASS',
  }) + '\n',
);
