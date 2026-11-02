/**
 * 打包前写出 `build/build-info.json`，由 electron-builder 的 `extraResources` 带进产物。
 *
 * 用法：`tsx scripts/release/write-build-info.mts <darwin|win32> <arm64|x64> [outDir]`
 *
 * 字段只从固定来源取：`git rev-parse HEAD`、精确 tag 探测、`git status`、`package.json`、构建时刻、
 * 命令行传入的平台与架构。**不读 `process.env`，不读 `os.*`**——白名单的边界在取值处就守住，
 * 而不是等测试来发现。
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUILD_INFO_FILE_NAME, createBuildInfo } from '../../platform/desktop/packaging/buildInfo'

function git(root: string, args: string[]): string | null {
  try {
    // 精确 tag 探测在没有匹配时会写 stderr：那是预期结果，不让它污染构建日志。
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

const args = process.argv.slice(2)
// `--require-clean`：发布通道用。带着未提交改动打出来的包，`commit` 记的是 HEAD，
// 但真正参与构建的改动不在那个提交里——记录得再准，记的也不是事实。
const requireClean = args.includes('--require-clean')
const [platform, arch, outDirArg] = args.filter((arg) => !arg.startsWith('--'))
if (!platform || !arch) {
  process.stderr.write('usage: write-build-info.mts <darwin|win32> <arm64|x64> [outDir] [--require-clean]\n')
  process.exit(2)
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = outDirArg ? resolve(outDirArg) : join(root, 'build')

const commit = git(root, ['rev-parse', 'HEAD'])
if (!commit) {
  process.stderr.write('build-info: not a git checkout, cannot record a commit\n')
  process.exit(1)
}

// 只有 HEAD 正好被某个 tag 指着才算「从 tag 打的」；拿不到就是 null，不许退而求其次写分支名。
const exactTag = git(root, ['describe', '--tags', '--exact-match', 'HEAD'])
const status = git(root, ['status', '--porcelain'])
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }

const info = createBuildInfo({
  commit,
  tag: exactTag && exactTag.length > 0 ? exactTag : null,
  dirty: status !== null && status.length > 0,
  version,
  builtAt: new Date(),
  platform,
  arch
})

if (requireClean && info.dirty) {
  process.stderr.write(
    'build-info: the working tree has uncommitted changes, so this build cannot be traced to its commit\n'
  )
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const target = join(outDir, BUILD_INFO_FILE_NAME)
writeFileSync(target, `${JSON.stringify(info, null, 2)}\n`)
process.stdout.write(`build-info: ${target}\n${JSON.stringify(info)}\n`)
