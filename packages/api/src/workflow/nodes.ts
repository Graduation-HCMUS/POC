import {
  conditionConfigSchema,
  customConfigSchema,
  fileConfigSchema,
  hasLegacyConfig,
  outputConfigSchema,
  predicateSchema,
} from '@packages/contracts';
import type {
  DataItem,
  NodeType,
  Port,
  WorkflowNode,
} from '@packages/contracts';
import { z } from 'zod';

import { executeCustom } from './custom.ts';
import type { FileStorage } from './file-operations.ts';
import { parseFile, readFile, writeFile } from './file-operations.ts';
import { WorkflowProblem } from './problems.ts';

export type NodeResult = Partial<Record<Port, DataItem[]>>;
type NodeContext = {
  storage: FileStorage;
  signal: AbortSignal;
  recordOutput: (name: string, items: DataItem[]) => void;
};
type NodeHandler = {
  schema: z.ZodType;
  execute: (
    node: WorkflowNode,
    items: DataItem[],
    context: NodeContext,
  ) => NodeResult | Promise<NodeResult>;
};

function matches(item: DataItem, predicate: z.infer<typeof predicateSchema>) {
  return (
    Object.hasOwn(item.json, predicate.field) &&
    item.json[predicate.field] === predicate.value
  );
}

export const nodeHandlers: Readonly<Record<NodeType, NodeHandler>> = {
  trigger: {
    schema: z.object({}),
    execute: (_node, items) => ({ main: items }),
  },
  output: {
    schema: outputConfigSchema,
    execute(node, items, context) {
      context.recordOutput(
        outputConfigSchema.parse(node.config).outputName,
        items,
      );
      return {};
    },
  },
  condition: {
    schema: conditionConfigSchema,
    execute(node, items) {
      const { branches } = conditionConfigSchema.parse(node.config);
      const result: Record<Port, DataItem[]> = { else: [] };
      for (const { id } of branches) result[id] = [];
      for (const item of items) {
        const branch = branches.find((rule) => matches(item, rule));
        result[branch?.id ?? 'else'].push(item);
      }
      return result;
    },
  },
  file: {
    schema: fileConfigSchema,
    async execute(node, items, { storage, signal }) {
      const config = fileConfigSchema.parse(node.config);
      switch (config.operation) {
        case 'read':
          return {
            main: await readFile(items, config.sourceKey, storage, signal),
          };
        case 'parse':
          return { main: parseFile(items, config.format) };
        case 'filter':
          return { main: items.filter((item) => matches(item, config)) };
        case 'write':
          return {
            main: await writeFile(
              items,
              config.format,
              config.fileName,
              storage,
              signal,
            ),
          };
      }
    },
  },
  custom: {
    schema: customConfigSchema,
    async execute(node, items, { signal }) {
      const { code } = customConfigSchema.parse(node.config);
      return { main: await executeCustom(code, items, signal) };
    },
  },
};

export function validateNodeConfig(node: WorkflowNode) {
  if (hasLegacyConfig(node)) {
    throw new WorkflowProblem({
      code: 'LEGACY_NODE_CONFIG',
      nodeId: node.id,
      message:
        'This node uses an older configuration. Rebuild its settings before running.',
    });
  }
  const result = nodeHandlers[node.type].schema.safeParse(node.config);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.join('.');
    throw new WorkflowProblem({
      code: 'INVALID_CONFIG',
      nodeId: node.id,
      message: field ? `${field}: ${issue.message}` : issue.message,
    });
  }
}
