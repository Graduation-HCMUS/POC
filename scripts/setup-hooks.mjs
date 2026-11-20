import { spawnSync } from 'node:child_process'
import { chmodSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('..', import.meta.url))
const git = spawnSync('git', ['rev-parse', '--git-dir'], {
  cwd,
  encoding: 'utf8',
})
if (git.status !== 0) {
  if (git.error) throw git.error
  console.log('No Git metadata: hooks were not activated.')
} else {
  chmodSync(new URL('../.githooks/pre-commit', import.meta.url), 0o755)
  const result = spawnSync(
    'git',
    ['config', '--local', 'core.hooksPath', '.githooks'],
    { cwd, stdio: 'inherit' },
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
