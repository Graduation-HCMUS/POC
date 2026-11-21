import {
  customConfigSchema,
  draftSchema,
  fileConfigSchema,
  limits,
  nodeCatalog,
  outputConfigSchema,
} from '@packages/contracts';
import type { WorkflowDraft } from '@packages/contracts';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { executeCustom } from '../workflow/custom.ts';
import { validateWorkflow } from '../workflow/graph.ts';
import { WorkflowProblem } from '../workflow/problems.ts';
import { domainContext } from './domain.ts';

export const generationRequestSchema = z.object({
  requirement: z.string().trim().min(10).max(2000),
});
export const model = 'qwen3:4b';
export const generationOptions = {
  num_ctx: 4096,
  num_predict: 2600,
  temperature: 0,
  seed: 17,
};
// Specialize the existing draft contract with its existing per-node configs.
// This changes only the generation constraint, not the stored workflow format.
const nodeShape = draftSchema.shape.nodes.element;
const generationShape = draftSchema.extend({
  nodes: draftSchema.shape.nodes.element
    .extend({ type: z.literal('trigger'), config: z.object({}) })
    .or(nodeShape.extend({ type: z.literal('file'), config: fileConfigSchema }))
    .or(
      nodeShape.extend({
        type: z.literal('custom'),
        config: customConfigSchema,
      }),
    )
    .or(
      nodeShape.extend({
        type: z.literal('output'),
        config: outputConfigSchema,
      }),
    )
    .array()
    .max(limits.nodes),
});
const workflowFormat = z.toJSONSchema(generationShape, {
  unrepresentable: 'any',
});
const timeoutMs = 360_000;
const ollama = 'http://127.0.0.1:11434';
let generating = false;

type OllamaReply = {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
};

export function buildPrompt(requirement: string) {
  return `Generate a Genie executable workflow, not a ticket classification answer. Return only JSON matching the supplied schema.
Business context:\n${domainContext}
Component catalog (port metadata only, NEVER copy label/input/output into node.config): ${JSON.stringify(nodeCatalog)}
Data: edges pass arrays of {json: object, files?: object}. Trigger starts with one item containing files.input, NOT ticket rows.
Allowed for this PoC: trigger config {}; file read config {operation:"read",sourceKey:"input"}; file parse config {operation:"parse",format:"csv"}; custom config {code:"JavaScript function body"}; output config {outputName:"classification"}.
Read produces json.content; Parse converts CSV into items, one per ticket. Custom reads items and must RETURN an array of {json: object}; it runs synchronously in a sandbox with no imports, process, fetch or external tools. The items variable is already defined: NEVER redeclare items, and NEVER use inputs (it does not exist). Each item wraps ticket fields under item.json, not directly under item. Preserve the exact literal terms including spaces and Vietnamese accents; never replace spaces with underscores. The invocation is Function('items', config.code)(items). An identity-transform example (not classification) is: return items.map((item) => ({json: {...item.json}})); Write all classification logic in Custom yourself. Do not output a function declaration without calling it.
Use only these allowed operations, one trigger and one output. Connect the necessary nodes from trigger to output. Every edge uses sourcePort:"main", targetPort:"main". IDs are unique strings. Names are short, positions spaced for readability. No disconnected nodes, cycles, fanout or merges. Preserve rows and original fields in Custom.
User requirement (must stay within this fixed classification policy):\n${requirement}`;
}

// Generation validates structure, not semantic correctness. The separate acceptance
// evaluation executes the returned code against an oracle the model never sees.
export function validateGeneratedWorkflow(raw: unknown): WorkflowDraft {
  const draft = draftSchema.parse(raw);
  const graph = validateWorkflow({ ...draft, id: randomUUID(), version: 1 });
  for (const node of draft.nodes) {
    const allowed =
      node.type === 'trigger' ||
      node.type === 'custom' ||
      (node.type === 'output' && node.config.outputName === 'classification') ||
      (node.type === 'file' &&
        ((node.config.operation === 'read' &&
          node.config.sourceKey === 'input') ||
          (node.config.operation === 'parse' && node.config.format === 'csv')));
    if (!allowed)
      throw new Error(`Unsupported classification operation at ${node.id}.`);
  }
  if (draft.nodes.filter((node) => node.type === 'output').length !== 1)
    throw new Error('Return exactly one classification output.');
  const path = [];
  let current = graph.trigger;
  for (;;) {
    path.push(current);
    const edge = graph.outgoing.get(current.id)?.get('main');
    if (!edge) break;
    current = graph.byId.get(edge.target)!;
  }
  const read = path.findIndex(
    (node) => node.type === 'file' && node.config.operation === 'read',
  );
  const parse = path.findIndex(
    (node) => node.type === 'file' && node.config.operation === 'parse',
  );
  const custom = path.findIndex((node) => node.type === 'custom');
  if (read < 0 || parse <= read || custom <= parse)
    throw new Error(
      'Read the uploaded file, then parse CSV, then classify ticket items in Custom.',
    );
  return draft;
}

export async function generateWorkflow(requirement: string) {
  if (generating)
    throw new WorkflowProblem({
      code: 'GENERATION_BUSY',
      message: 'Another local generation is running. Wait for it to finish.',
    });
  generating = true;
  const prompt = buildPrompt(requirement);
  const started = performance.now();
  try {
    const attempts = [];
    let workflow: WorkflowDraft | null = null;
    let repairCount = 0;
    let retryCount = 0;
    let content = prompt;
    // At most two calls: one repair for contract failures OR one transport retry.
    for (let index = 0; index < 2; index++) {
      const callStarted = performance.now();
      let reply: OllamaReply;
      try {
        const response = await fetch(`${ollama}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
          body: JSON.stringify({
            model,
            stream: false,
            think: false,
            keep_alive: '5m',
            messages: [{ role: 'user', content }],
            format: workflowFormat,
            options: generationOptions,
          }),
        });
        if (!response.ok)
          throw new Error(
            `Ollama HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`,
          );
        reply = (await response.json()) as OllamaReply;
      } catch (error) {
        const message = `Local ${model} generation failed: ${error instanceof Error ? error.message : 'unknown error'}`;
        attempts.push({
          prompt: content,
          raw: '',
          jsonValid: false,
          schemaValid: false,
          structuralValid: false,
          contractValid: false,
          validationErrors: [message],
          latencyMs: Math.round(performance.now() - callStarted),
          promptTokens: null,
          completionTokens: null,
          doneReason: null,
        });
        if (index === 0) {
          retryCount++;
          continue;
        }
        break;
      }
      const raw = reply.message?.content ?? '';
      let jsonValid = false;
      let schemaValid = false;
      let structuralValid = false;
      const validationErrors: string[] = [];
      try {
        const parsed: unknown = JSON.parse(raw);
        jsonValid = true;
        schemaValid = draftSchema.safeParse(parsed).success;
        if (!reply.done || reply.done_reason !== 'stop')
          throw new Error('Model output did not finish normally.');
        const draft = validateGeneratedWorkflow(parsed);
        structuralValid = true;
        // This probes only the executable component contract, with no expected
        // category. Semantic evaluation remains separate and uses a hidden oracle.
        for (const node of draft.nodes.filter(
          (node) => node.type === 'custom',
        )) {
          await executeCustom(
            customConfigSchema.parse(node.config).code,
            [{ json: { id: 'contract-probe', subject: '', description: '' } }],
            AbortSignal.timeout(5000),
          );
        }
        workflow = draft;
      } catch (error) {
        validationErrors.push(
          error instanceof Error ? error.message : 'Invalid generated workflow',
        );
      }
      attempts.push({
        prompt: content,
        raw,
        jsonValid,
        schemaValid,
        structuralValid,
        contractValid: workflow !== null,
        validationErrors,
        doneReason: reply.done_reason ?? null,
        latencyMs: Math.round(performance.now() - callStarted),
        promptTokens: reply.prompt_eval_count ?? null,
        completionTokens: reply.eval_count ?? null,
      });
      if (workflow) break;
      if (index === 0) repairCount++;
      content = `Repair this invalid workflow JSON. Return the entire corrected workflow, preserving its policy. Errors: ${validationErrors.join('; ')}.
Custom config.code is a JavaScript FUNCTION BODY: read the global items array; ticket fields are item.json.subject and item.json.description; RETURN an array of {json: {...item.json, category, manual_review, reason, matched_categories}}. A function declaration alone returns undefined. Do not change the classification policy. No imports or runtime LLM.
Invalid output:\n${raw}`;
    }
    return {
      workflow,
      model,
      prompt,
      options: generationOptions,
      timeoutMs,
      format: workflowFormat,
      attempts,
      callCount: attempts.length,
      repairCount,
      retryCount,
      latencyMs: Math.round(performance.now() - started),
    };
  } finally {
    generating = false;
  }
}
