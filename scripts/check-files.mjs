import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

export const codeFile = /\.(?:[cm]?js|jsx|ts|tsx)$/i
export const formattedFile = /\.(?:[cm]?js|jsx|ts|tsx|json|css|html|md|ya?ml)$/i

export function execute(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status})`)
  return result
}

export function checkFiles(root, files, lint = false) {
  for (const workspace of ['', 'packages/api', 'packages/web']) {
    const selected = files
      .filter((file) => {
        const owner = file.startsWith('packages/api/')
          ? 'packages/api'
          : file.startsWith('packages/web/')
            ? 'packages/web'
            : ''
        return owner === workspace
      })
      .map((file) => resolve(root, file))
    // Batch to stay below Windows command-line limits.
    for (let offset = 0; offset < selected.length; offset += 40) {
      const batch = selected.slice(offset, offset + 40)
      const cwd = resolve(root, workspace)
      execute(
        process.execPath,
        [
          resolve(root, 'node_modules/prettier/bin/prettier.cjs'),
          '--check',
          ...batch,
        ],
        cwd,
      )
      if (lint)
        execute(
          process.execPath,
          [
            resolve(root, 'node_modules/eslint/bin/eslint.js'),
            '--max-warnings',
            '0',
            ...batch,
          ],
          cwd,
        )
    }
  }
}
