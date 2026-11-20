import { limits, outputPorts } from '@packages/contracts';
import type {
  DataItem,
  JsonPreview,
  NodeRun,
  NodeTrace,
  RunResult,
  WorkflowIssue,
  WorkflowNode,
} from '@packages/contracts';

import type { FileStorage } from './file-operations.ts';
import type { validateWorkflow } from './graph.ts';
import { nodeHandlers } from './nodes.ts';
import { WorkflowProblem } from './problems.ts';

type Graph = ReturnType<typeof validateWorkflow>;
type ExecutionResult = Pick<
  RunResult,
  'nodeRuns' | 'outputs' | 'warnings' | 'error'
>;

const previewBytes = 16 * 1024;

function preview(items: DataItem[]): JsonPreview {
  const text = JSON.stringify(items, null, 2);
  const bytes = Buffer.from(text);
  if (bytes.length <= previewBytes) return { text, truncated: false };
  return {
    text: new TextDecoder().decode(bytes.subarray(0, previewBytes), {
      stream: true,
    }),
    truncated: true,
  };
}

export async function executeWorkflow(
  graph: Graph,
  input: DataItem[],
  storage: FileStorage,
): Promise<ExecutionResult> {
  const queue: { node: WorkflowNode; items: DataItem[] }[] = [
    { node: graph.trigger, items: input },
  ];
  const outputEntries = new Map<string, DataItem[]>();
  const nodeRuns: NodeRun[] = [];
  const deadline = performance.now() + limits.runMs;
  const signal = AbortSignal.timeout(limits.runMs);
  const warnings: WorkflowIssue[] = [];
  function checkTime() {
    if (signal.aborted || performance.now() >= deadline) {
      throw new WorkflowProblem({
        code: 'RUN_TIMEOUT',
        message: 'Run exceeded 10 seconds.',
      });
    }
  }
  function recordOutput(name: string, items: DataItem[]) {
    outputEntries.set(name, items);
    if (
      Buffer.byteLength(JSON.stringify(Object.fromEntries(outputEntries))) >
      limits.outputBytes
    ) {
      throw new WorkflowProblem({
        code: 'OUTPUT_LIMIT',
        message: 'Run output exceeds 2 MiB.',
      });
    }
  }

  for (const { node, items } of queue) {
    const started = performance.now();
    const trace: NodeTrace = { input: preview(items), outputs: {} };
    const log: NodeRun = {
      sequence: nodeRuns.length + 1,
      nodeId: node.id,
      status: 'success',
      inputCount: items.length,
      outputCounts: {},
      durationMs: 0,
      error: null,
      trace,
    };
    nodeRuns.push(log);

    try {
      checkTime();
      const result = await nodeHandlers[node.type].execute(node, items, {
        storage,
        signal,
        recordOutput(name, outputItems) {
          recordOutput(name, outputItems);
          trace.result = { name, data: preview(outputItems) };
        },
      });
      checkTime();
      for (const { id: port, label } of outputPorts(node)) {
        const outgoingItems = result[port] ?? [];
        log.outputCounts[port] = outgoingItems.length;
        if (outgoingItems.length > limits.items) {
          throw new WorkflowProblem({
            code: 'ITEM_LIMIT',
            message: 'Node output exceeds 1,000 items.',
          });
        }
        trace.outputs[port] = preview(outgoingItems);
        const edge = graph.outgoing.get(node.id)?.get(port);
        const target = edge && graph.byId.get(edge.target);
        if (node.type === 'condition' && !target && outgoingItems.length > 0) {
          warnings.push({
            code: 'UNCONNECTED_BRANCH',
            nodeId: node.id,
            message: `The '${label}' branch is unconnected. ${outgoingItems.length} item(s) stopped here.`,
          });
        }
        if (target && outgoingItems.length > 0)
          queue.push({ node: target, items: outgoingItems });
      }
    } catch (error) {
      const problem =
        signal.aborted || performance.now() >= deadline
          ? { code: 'RUN_TIMEOUT', message: 'Run exceeded 10 seconds.' }
          : error instanceof WorkflowProblem
            ? error.issue
            : { code: 'NODE_FAILED', message: 'Node could not complete.' };
      log.status = 'failed';
      log.error = { ...problem, nodeId: node.id };
      return {
        nodeRuns,
        outputs: {},
        warnings,
        error: log.error,
      };
    } finally {
      log.durationMs = Math.round(performance.now() - started);
    }
  }
  return {
    nodeRuns,
    outputs: Object.fromEntries(outputEntries),
    warnings,
    error: null,
  };
}
