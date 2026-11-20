import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkflowDraft } from '@packages/contracts'

import {
  canConnect,
  fromDraft,
  initialConfig,
  toDraft,
} from '../src/workflow/graph.ts'

void test('round trips the branch port and position while omitting React Flow state', () => {
  const draft: WorkflowDraft = {
    name: 'Test',
    nodes: [
      {
        id: 'start',
        name: 'Start',
        type: 'condition',
        position: { x: 100, y: 20 },
        config: {},
      },
      {
        id: 'end',
        name: 'End',
        type: 'output',
        position: { x: 270, y: 80 },
        config: {},
      },
    ],
    edges: [
      {
        id: 'edge',
        source: 'start',
        sourcePort: 'else',
        target: 'end',
        targetPort: 'main',
      },
    ],
  }
  const { nodes, edges } = fromDraft(draft)
  nodes[0].selected = true
  edges[0].selected = true
  assert.equal(edges[0].sourceHandle, 'else')
  assert.deepEqual(toDraft(draft.name, nodes, edges), draft)
  assert.equal(canConnect(edges[0], nodes, []), true)
  assert.equal(canConnect(edges[0], nodes, edges), false)
})

void test('new Condition nodes get their own branch IDs', () => {
  assert.notDeepEqual(initialConfig('condition'), initialConfig('condition'))
})
