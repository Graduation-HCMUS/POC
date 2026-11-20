import { z } from 'zod'

export const limits = {
  nodes: 50,
  items: 1_000,
  fileBytes: 2 * 1024 * 1024,
  outputBytes: 2 * 1024 * 1024,
  runMs: 10_000,
  conditionRules: 6,
  customCodeBytes: 8 * 1024,
  customDataBytes: 2 * 1024 * 1024,
  customMemoryBytes: 32 * 1024 * 1024,
  customCodeMs: 1_000,
  customWorkerMs: 3_000,
} as const

export const nodeTypes = [
  'trigger',
  'output',
  'condition',
  'file',
  'custom',
] as const
export const fileFormats = ['csv', 'md', 'txt'] as const
export const fileOperations = ['read', 'parse', 'filter', 'write'] as const
const portSchema = z.union([
  z.enum(['main', 'else', 'true', 'false']),
  z.uuid(),
])
export type Port = z.infer<typeof portSchema>
export type NodeType = (typeof nodeTypes)[number]

export const nodeCatalog = {
  trigger: { label: 'Trigger', input: [], output: ['main'] },
  output: { label: 'Output', input: ['main'], output: [] },
  condition: { label: 'Condition', input: ['main'], output: [] },
  file: { label: 'File Handling', input: ['main'], output: ['main'] },
  custom: { label: 'Custom', input: ['main'], output: ['main'] },
} as const satisfies Record<
  NodeType,
  { label: string; input: readonly Port[]; output: readonly Port[] }
>

const jsonObject = z.record(z.string(), z.json())
const graphId = z.string().min(1).max(100)
const fileRefSchema = z.object({
  fileId: z.uuid(),
  fileName: z.string().min(1).max(160),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int().min(0).max(limits.fileBytes),
})
export const dataItemSchema = z.object({
  json: jsonObject,
  files: z.record(z.string(), fileRefSchema).optional(),
})
export const runInputSchema = z.object({
  version: z.number().int().positive().max(2_147_483_647),
  fileId: z.uuid(),
})

const workflowNodeSchema = z.object({
  id: graphId,
  type: z.enum(nodeTypes),
  name: z.string().trim().min(1).max(100),
  config: jsonObject,
  position: z.object({ x: z.number(), y: z.number() }),
})
const workflowEdgeSchema = z.object({
  id: graphId,
  source: graphId,
  sourcePort: portSchema,
  target: graphId,
  targetPort: z.literal('main'),
})
export const draftSchema = z.object({
  name: z.string().trim().min(1).max(100),
  nodes: z.array(workflowNodeSchema).max(limits.nodes),
  edges: z.array(workflowEdgeSchema).max(limits.nodes - 1),
})
export const workflowSchema = draftSchema.extend({
  id: z.uuid(),
  version: runInputSchema.shape.version,
})
export const updateSchema = draftSchema.extend({
  version: workflowSchema.shape.version,
})

export const predicateSchema = z.object({
  field: z.string().trim().min(1).max(100),
  op: z.literal('eq'),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
})
const branchSchema = predicateSchema.extend({
  id: z.uuid(),
  field: z.string().max(100),
})
export const conditionDraftSchema = z.object({
  branches: z
    .array(branchSchema)
    .min(1)
    .max(limits.conditionRules)
    .refine(
      (branches) =>
        new Set(branches.map(({ id }) => id)).size === branches.length,
      'Branch IDs must be unique.',
    ),
})
export const conditionConfigSchema = conditionDraftSchema
  .transform(({ branches }) => ({
    branches: branches.map((branch) => ({
      ...branch,
      field: branch.field.trim(),
    })),
  }))
  .refine(({ branches }) => branches.every(({ field }) => field.length > 0), {
    path: ['branches'],
    message: 'Every rule needs a field.',
  })
export const fileConfigSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('read'),
    sourceKey: z.string().min(1).max(100),
  }),
  z.object({ operation: z.literal('parse'), format: z.enum(fileFormats) }),
  predicateSchema.extend({ operation: z.literal('filter') }),
  z.object({
    operation: z.literal('write'),
    format: z.enum(fileFormats),
    fileName: z.string().trim().min(1).max(160),
  }),
])
export const outputConfigSchema = z.object({
  outputName: z.string().trim().min(1).max(100),
})
export const customConfigSchema = z.object({
  code: z
    .string()
    .max(limits.customCodeBytes)
    .refine((code) => code.trim().length > 0, 'Enter JavaScript code.')
    .refine(
      (code) => new TextEncoder().encode(code).length <= limits.customCodeBytes,
      'JavaScript code exceeds 8 KiB.',
    ),
})

export type FileRef = z.infer<typeof fileRefSchema>
export type DataItem = z.infer<typeof dataItemSchema>
export type WorkflowNode = z.infer<typeof workflowNodeSchema>
export type ConditionBranch = z.infer<typeof branchSchema>

type NodeConfig = Pick<WorkflowNode, 'type' | 'config'>
export function hasLegacyConfig({ type, config }: NodeConfig) {
  return (
    (type === 'condition' && !('branches' in config) && 'field' in config) ||
    (type === 'custom' && !('code' in config) && 'functionName' in config)
  )
}

export function outputPorts(
  node: NodeConfig,
): ReadonlyArray<{ id: Port; label: string }> {
  if (node.type !== 'condition') {
    return nodeCatalog[node.type].output.map((id) => ({ id, label: id }))
  }
  if (hasLegacyConfig(node)) {
    return [
      { id: 'true', label: 'true' },
      { id: 'false', label: 'false' },
    ]
  }
  const draft = conditionDraftSchema.safeParse(node.config)
  return [
    ...(draft.success
      ? draft.data.branches.map(({ id }, index) => ({
          id,
          label: index === 0 ? 'If' : `Else if ${index}`,
        }))
      : []),
    { id: 'else', label: 'Else' },
  ]
}
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>
export type WorkflowDraft = z.infer<typeof draftSchema>
export type WorkflowDefinition = z.infer<typeof workflowSchema>
export type WorkflowSummary = Pick<
  WorkflowDefinition,
  'id' | 'name' | 'version'
>
export type RunInput = z.infer<typeof runInputSchema>
export type WorkflowIssue = {
  code: string
  message: string
  nodeId?: string
  edgeId?: string
}
export type RunError = WorkflowIssue
export type JsonPreview = {
  text: string
  truncated: boolean
}
export type NodeTrace = {
  input: JsonPreview
  outputs: Partial<Record<Port, JsonPreview>>
  result?: { name: string; data: JsonPreview }
}
export type NodeRun = {
  sequence: number
  nodeId: string
  status: 'success' | 'failed'
  inputCount: number
  outputCounts: Partial<Record<Port, number>>
  durationMs: number
  error: RunError | null
  trace: NodeTrace | null
}
export type RunSummary = {
  id: string
  workflowId: string
  workflowVersion: number
  status: 'running' | 'success' | 'failed'
  startedAt: string
  finishedAt: string | null
}
export type RunResult = RunSummary & {
  workflowSnapshot: WorkflowDefinition
  nodeRuns: NodeRun[]
  outputs: Record<string, DataItem[]>
  warnings: WorkflowIssue[]
  error: RunError | null
}
