import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isHealthyResponse } from '../src/health.ts'

test('accepts a healthy API response', () => {
  assert.equal(isHealthyResponse({ status: 'ok' }), true)
})

test('rejects unavailable or malformed responses', () => {
  for (const value of [null, undefined, 'ok', {}, { status: 'error' }]) {
    assert.equal(isHealthyResponse(value), false)
  }
})
