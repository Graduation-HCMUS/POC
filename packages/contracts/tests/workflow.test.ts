import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  conditionConfigSchema,
  conditionDraftSchema,
  draftSchema,
  runInputSchema,
} from '../workflow.ts'

void test('drafts may have no nodes and reject malformed positions', () => {
  assert.equal(
    draftSchema.safeParse({ name: 'Draft', nodes: [], edges: [] }).success,
    true,
  )
  const node = {
    id: 'trigger',
    type: 'trigger',
    name: 'Start',
    config: {},
    position: { x: 'bad', y: 0 },
  }
  assert.equal(
    draftSchema.safeParse({ name: 'Draft', nodes: [node], edges: [] }).success,
    false,
  )
})

void test('runs require one stored file ID', () => {
  const fileId = 'aea4ab57-d3e3-444c-bbf3-a4e0d6761d23'
  assert.equal(runInputSchema.safeParse({ version: 1, fileId }).success, true)
  assert.equal(
    runInputSchema.safeParse({ version: 1, fileId: [fileId] }).success,
    false,
  )
  assert.equal(
    runInputSchema.safeParse({ version: 1, input: [] }).success,
    false,
  )
})

void test('Condition drafts may have empty fields and branch IDs are unique', () => {
  const branch = {
    id: 'aea4ab57-d3e3-444c-bbf3-a4e0d6761d23',
    field: '',
    op: 'eq',
    value: '',
  }
  assert.equal(
    conditionDraftSchema.safeParse({ branches: [branch] }).success,
    true,
  )
  assert.equal(
    conditionConfigSchema.safeParse({ branches: [branch] }).success,
    false,
  )
  assert.equal(
    conditionDraftSchema.safeParse({ branches: [branch, branch] }).success,
    false,
  )
})
