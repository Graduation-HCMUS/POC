import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { checkFiles, codeFile, execute } from './check-files.mjs'

const rootResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
})
if (rootResult.status !== 0)
  throw new Error('precommit must run inside a Git checkout')
const root = rootResult.stdout.trim()
const staged = execute(
  'git',
  ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'],
  root,
  { encoding: 'utf8', stdio: 'pipe' },
)
const files = staged.stdout.split('\0').filter((file) => codeFile.test(file))
if (!files.length) {
  console.log('No staged JavaScript/TypeScript files to check.')
} else {
  const snapshot = mkdtempSync(join(tmpdir(), 'genie-staged-'))
  try {
    execute(
      'git',
      [
        'checkout-index',
        '--all',
        `--prefix=${snapshot.replaceAll('\\', '/')}/`,
      ],
      root,
    )
    for (const workspace of ['', 'packages/api', 'packages/web']) {
      const dependencies = resolve(root, workspace, 'node_modules')
      if (existsSync(dependencies))
        symlinkSync(
          dependencies,
          resolve(snapshot, workspace, 'node_modules'),
          'junction',
        )
    }
    checkFiles(snapshot, files, true)
  } finally {
    rmSync(snapshot, { recursive: true, force: true })
  }
}
