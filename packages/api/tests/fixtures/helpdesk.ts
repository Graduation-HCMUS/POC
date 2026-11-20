import type {
  WorkflowDraft,
  WorkflowEdge,
  WorkflowNode,
} from '@packages/contracts';

function node(
  id: string,
  type: WorkflowNode['type'],
  config: WorkflowNode['config'] = {},
): WorkflowNode {
  return { id, type, name: id, config, position: { x: 0, y: 0 } };
}

export function edge(
  source: string,
  target: string,
  sourcePort: WorkflowEdge['sourcePort'] = 'main',
): WorkflowEdge {
  return {
    id: `${source}-${target}`,
    source,
    sourcePort,
    target,
    targetPort: 'main',
  };
}

export const basicWorkflow: WorkflowDraft = {
  name: 'Trigger to Output',
  nodes: [
    node('trigger', 'trigger'),
    node('output', 'output', { outputName: 'result' }),
  ],
  edges: [edge('trigger', 'output')],
};

export const highPort = 'bbd8982e-c165-4d4a-8bd2-c25ca3435630';
export const mediumPort = '09df51d4-22b6-4bc2-ba37-30826b086700';
export const summaryCode = `return items.map((item) => {
  const { id, subject } = item.json
  if (typeof id !== 'string' || typeof subject !== 'string') {
    throw new Error('Expected string id and subject fields')
  }
  return { ...item, json: { ...item.json, summary: '#' + id + ' — ' + subject } }
})`;

export const helpdeskWorkflow: WorkflowDraft = {
  name: 'Helpdesk ticket triage',
  nodes: [
    node('trigger', 'trigger'),
    node('read', 'file', { operation: 'read', sourceKey: 'input' }),
    node('parse', 'file', { operation: 'parse', format: 'csv' }),
    node('filter', 'file', {
      operation: 'filter',
      field: 'status',
      op: 'eq',
      value: 'open',
    }),
    node('priority', 'condition', {
      branches: [
        { id: highPort, field: 'priority', op: 'eq', value: 'high' },
        { id: mediumPort, field: 'priority', op: 'eq', value: 'medium' },
      ],
    }),
    node('summary', 'custom', { code: summaryCode }),
    node('write', 'file', {
      operation: 'write',
      format: 'md',
      fileName: 'urgent.md',
    }),
    node('urgent', 'output', { outputName: 'urgentFile' }),
    node('medium', 'output', { outputName: 'mediumTickets' }),
    node('normal', 'output', { outputName: 'normalTickets' }),
  ],
  edges: [
    edge('trigger', 'read'),
    edge('read', 'parse'),
    edge('parse', 'filter'),
    edge('filter', 'priority'),
    edge('priority', 'summary', highPort),
    edge('priority', 'medium', mediumPort),
    edge('priority', 'normal', 'else'),
    edge('summary', 'write'),
    edge('write', 'urgent'),
  ],
};

export const helpdeskOrder = [
  'trigger',
  'read',
  'parse',
  'filter',
  'priority',
  'summary',
  'medium',
  'normal',
  'write',
  'urgent',
];
