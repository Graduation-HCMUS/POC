import { nodeCatalog, outputPorts } from '@packages/contracts'
import type {
  ConditionBranch,
  NodeType,
  WorkflowDraft,
  WorkflowNode,
} from '@packages/contracts'
import type { Connection, Edge, Node } from '@xyflow/react'

export type CanvasNode = Node<
  Pick<WorkflowNode, 'type' | 'name' | 'config'>,
  'workflow'
>

export function fromDraft(draft: WorkflowDraft) {
  const nodes: CanvasNode[] = draft.nodes.map(({ id, position, ...data }) => ({
    id,
    type: 'workflow',
    position,
    data,
  }))
  const edges: Edge[] = draft.edges.map(
    ({ id, source, target, sourcePort, targetPort }) => ({
      id,
      source,
      target,
      sourceHandle: sourcePort,
      targetHandle: targetPort,
    }),
  )
  return { nodes, edges }
}

export function toDraft(
  name: string,
  nodes: CanvasNode[],
  edges: Edge[],
): WorkflowDraft {
  return {
    name,
    nodes: nodes.map(({ id, data, position }) => ({ id, ...data, position })),
    edges: edges.map(({ id, source, target, sourceHandle }) => ({
      id,
      source,
      target,
      sourcePort: sourceHandle ?? 'main',
      targetPort: 'main',
    })),
  }
}

export function canConnect(
  connection: Connection | Edge,
  nodes: CanvasNode[],
  edges: Edge[],
) {
  const { source, sourceHandle, target, targetHandle } = connection
  if (source === target || targetHandle !== 'main') return false
  const start = nodes.find(({ id }) => id === source)
  const end = nodes.find(({ id }) => id === target)
  if (!start || !end || !nodeCatalog[end.data.type].input.length) return false
  const ports = outputPorts(start.data)
  return (
    ports.some(({ id }) => id === sourceHandle) &&
    !edges.some(
      (edge) =>
        edge.target === target ||
        (edge.source === source && edge.sourceHandle === sourceHandle),
    )
  )
}

const defaults: Record<NodeType, WorkflowNode['config']> = {
  trigger: {},
  output: { outputName: 'result' },
  condition: {},
  file: { operation: 'read', sourceKey: 'input' },
  custom: { code: 'return items' },
}

export function newBranch(): ConditionBranch {
  return { id: crypto.randomUUID(), field: '', op: 'eq', value: '' }
}

export function initialConfig(type: NodeType): WorkflowNode['config'] {
  return type === 'condition' ? { branches: [newBranch()] } : defaults[type]
}
