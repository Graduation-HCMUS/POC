import {
  nodeCatalog,
  outputConfigSchema,
  outputPorts,
  workflowSchema,
} from '@packages/contracts';
import type {
  Port,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowIssue,
} from '@packages/contracts';

import { validateNodeConfig } from './nodes.ts';
import { WorkflowProblem } from './problems.ts';

export function validateWorkflow(workflow: WorkflowDefinition) {
  const shape = workflowSchema.safeParse(workflow);
  if (!shape.success) {
    throw new WorkflowProblem({
      code: 'INVALID_WORKFLOW',
      message: shape.error.issues[0].message,
    });
  }

  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const triggerNodes = workflow.nodes.filter((node) => node.type === 'trigger');
  const outputs = workflow.nodes.filter((node) => node.type === 'output');
  const outgoing = new Map<string, Map<Port, WorkflowEdge>>();
  const incoming = new Map<string, WorkflowEdge>();
  const edgeIds = new Set<string>();
  const outputNames = new Set<string>();

  const fail = (
    code: string,
    message: string,
    location: Pick<WorkflowIssue, 'nodeId' | 'edgeId'> = {},
  ): never => {
    throw new WorkflowProblem({ code, message, ...location });
  };

  if (byId.size !== workflow.nodes.length)
    fail('DUPLICATE_NODE_ID', 'Node IDs must be unique.');
  if (triggerNodes.length !== 1)
    fail('TRIGGER_COUNT', 'Add exactly one Trigger node.');
  if (!outputs.length) fail('OUTPUT_REQUIRED', 'Add at least one Output node.');
  const trigger = triggerNodes[0];
  for (const node of workflow.nodes) validateNodeConfig(node);

  for (const edge of workflow.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const location = { edgeId: edge.id };
    if (edgeIds.has(edge.id))
      fail('DUPLICATE_EDGE_ID', 'Connection IDs must be unique.', location);
    edgeIds.add(edge.id);
    if (!source || !target) {
      throw new WorkflowProblem({
        code: 'UNKNOWN_NODE',
        message: 'Connection refers to a missing node.',
        ...location,
      });
    }

    const sourcePorts = outputPorts(source);
    const targetPorts: readonly Port[] = nodeCatalog[target.type].input;
    if (
      !sourcePorts.some(({ id }) => id === edge.sourcePort) ||
      !targetPorts.includes(edge.targetPort)
    ) {
      fail('INVALID_PORT', 'Connection uses an invalid port.', location);
    }
    const ports = outgoing.get(source.id) ?? new Map<Port, WorkflowEdge>();
    if (ports.has(edge.sourcePort))
      fail('FAN_OUT_NOT_SUPPORTED', 'Connect each output port once.', location);
    if (incoming.has(target.id))
      fail('MULTIPLE_INCOMING', 'Connect each node input once.', location);
    ports.set(edge.sourcePort, edge);
    outgoing.set(source.id, ports);
    incoming.set(target.id, edge);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(nodeId: string) {
    if (visiting.has(nodeId))
      fail('CYCLE_DETECTED', 'Remove the circular connection.', { nodeId });
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const edge of outgoing.get(nodeId)?.values() ?? []) visit(edge.target);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  visit(trigger.id);
  const reachable = new Set(visited);
  for (const node of workflow.nodes) visit(node.id);

  for (const node of workflow.nodes) {
    const location = { nodeId: node.id };
    if (!reachable.has(node.id))
      fail(
        'UNREACHABLE_NODE',
        'Connect this node to a path from Trigger.',
        location,
      );
    if (node.type !== 'output' && !outgoing.has(node.id))
      fail(
        'DEAD_END',
        'Connect this node to a path ending at Output.',
        location,
      );

    if (node.type === 'output') {
      const name = outputConfigSchema.parse(node.config).outputName;
      if (outputNames.has(name))
        fail(
          'DUPLICATE_OUTPUT',
          'Give each Output node a unique name.',
          location,
        );
      outputNames.add(name);
    }
  }
  return { trigger, byId, outgoing };
}
