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

/**
 * 本地 dev 的两个 Windows 兼容默认值（只影响 `pnpm dev` / `pnpm start`，不影响打包产物）：
 * - 受限/管理员会话里 Chromium sandbox 可能直接 EXCEPTION_BREAKPOINT；默认加 `--no-sandbox`。
 * - Electron 在本机某些会话下是 Low Integrity，写不了 `%APPDATA%`；默认把 userData
 *   放到仓库已忽略的 `.devdata/`，让 SQLite 有可写目录。
 *
 * 仍可显式覆盖：`NO_SANDBOX=0` 关掉 no-sandbox；`MACROBAY_USER_DATA=...` 换目录。
 */
if (process.platform === 'win32') {
  env.NO_SANDBOX ??= '1'
  env.MACROBAY_USER_DATA ??= join(repoRoot, '.devdata')
}

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
