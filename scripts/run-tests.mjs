import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { run } from 'node:test'
import { spec } from 'node:test/reporters'

function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = resolve(directory, entry.name)
    return entry.isDirectory()
      ? discover(file)
      : file.endsWith('.test.ts')
        ? [file]
        : []
  })
}

const files = discover('tests')
if (!files.length) throw new Error('No test files discovered')
let executed = 0
const stream = run({ files, concurrency: 1, isolation: 'none' })
stream.on('test:fail', () => {
  process.exitCode = 1
})
stream.on('test:pass', (result) => {
  // Node reports an empty test file as a synthetic passing test.
  if (
    result.details.type !== 'suite' &&
    result.name !== result.file &&
    !result.skip &&
    !result.todo
  )
    executed++
})
stream.on('test:summary', (summary) => {
  if (!summary.success) process.exitCode = 1
})
stream.on('end', () => {
  if (executed === 0) {
    console.error('No real tests executed')
    process.exitCode = 1
  }
})
stream.compose(spec).pipe(process.stdout)
