import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkFiles, formattedFile } from './check-files.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
function collect(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', 'dist', 'coverage'].includes(entry.name)) return []
    const file = resolve(directory, entry.name)
    return entry.isDirectory()
      ? collect(file)
      : [relative(root, file).replaceAll('\\', '/')]
  })
}
const tracked = spawnSync('git', ['ls-files', '--cached', '-z'], {
  cwd: root,
  encoding: 'utf8',
})
const files = [
  ...new Set([
    ...(tracked.status === 0 ? tracked.stdout.split('\0') : []),
    'package.json',
    'package-lock.json',
    '.prettierrc.json',
    'eslint.config.mjs',
    'README.md',
    'workspace-setup-report.md',
    ...['packages', 'scripts', '.github'].flatMap((directory) =>
      collect(resolve(root, directory)),
    ),
  ]),
].filter((file) => formattedFile.test(file) && existsSync(resolve(root, file)))
checkFiles(root, files)
