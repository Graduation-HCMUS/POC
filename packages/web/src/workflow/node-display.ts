import { conditionDraftSchema } from '@packages/contracts'
import type { NodeType, WorkflowNode } from '@packages/contracts'

export const nodeIcons: Record<NodeType, string> = {
  trigger: '▷',
  output: '↗',
  condition: '⑂',
  file: '▤',
  custom: 'ƒ',
}

export function configSummary(type: NodeType, config: WorkflowNode['config']) {
  switch (type) {
    case 'trigger':
      return 'Manual run'
    case 'output':
      return typeof config.outputName === 'string' && config.outputName
        ? config.outputName
        : 'Set an output name'
    case 'condition': {
      const draft = conditionDraftSchema.safeParse(config)
      const count = draft.success ? draft.data.branches.length : 0
      return count
        ? `${count} ${count === 1 ? 'rule' : 'rules'} + Else`
        : 'Legacy condition'
    }
    case 'file':
      return [config.operation, config.format]
        .filter((value): value is string => typeof value === 'string')
        .join(' · ')
    case 'custom':
      return 'JavaScript'
  }
}
