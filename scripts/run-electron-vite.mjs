#!/usr/bin/env node
/**
 * Cross-platform launcher for electron-vite.
 *
 * The previous commands used `env -u ELECTRON_RUN_AS_NODE`, which only exists on
 * POSIX shells and breaks `pnpm dev` on Windows. Spawning Node with a scrubbed
 * environment gives the same guarantee everywhere.
 */
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const mode = process.argv[2] === 'preview' ? 'preview' : 'dev'
const cli = join(repoRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(process.execPath, [cli, mode, '--config', 'electron.vite.config.ts'], {
  cwd: repoRoot,
  env,
  stdio: 'inherit'
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
