import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * 跨平台（Windows）守卫：**能在 macOS/Linux 上静态查出来的那几条**。
 *
 * 背景（2026-11-04）：合并进来的两个 Windows bug 都不是逻辑错，是「假设这里是 Unix」——
 * TMP/TEMP 一定可写、`relative()` 一定给正斜杠。它们只在 Windows 上炸，而 CI 只跑 macOS、
 * release 的 Windows 作业不跑测试，于是这类问题第一次运行是在用户机器上。
 *
 * 这里放**不依赖 Windows 就能判**的四条；剩下三条（文件占用、260 字符长路径、真实 CRLF 检出）
 * 只能靠 `ci.yml` 的 `windows` 作业真跑，见清单「跨平台」一节。
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const read = (relativePath: string): string => readFileSync(`${ROOT}${relativePath}`, 'utf8')

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.mjs', '.cjs'] as const

function listSourceFiles(dir: string): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return []
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    if (!SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) return []
    if (entry.name.includes('.test.')) return []
    return [fullPath]
  })
}

function productionSources(): string[] {
  return ['platform', 'products', 'apps', 'scripts'].flatMap((root) => listSourceFiles(join(ROOT, root)))
}

describe('cross-platform guards', () => {
  it('declares LF for text files, so a Windows checkout cannot write CRLF', () => {
    // `pnpm build:info --require-clean` 比较的是工作区是否干净：Windows 上 `core.autocrlf=true`
    // 检出时写 CRLF，下一次生成就看起来「文件被改过」，打包直接拒绝。这条必须在仓库层面声明，
    // 不能指望每个人本地配置对。
    const attributes = read('.gitattributes')
    const lines = attributes
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))

    const globalLf = lines.some((line) => /^\*\s+text=auto\s+eol=lf$/u.test(line))
    expect(
      globalLf,
      '.gitattributes 缺全局规则 `* text=auto eol=lf`：Windows 检出会写 CRLF，`--require-clean` 会因此拒绝打包。'
    ).toBe(true)

    // 例外必须显式（二进制/字节级 fixture）：默认规则 + 逐条 -text 才是可读的。
    expect(
      lines.some((line) => /\s-text$/u.test(line)),
      '二进制 fixture 需要逐条 `-text` 例外，否则它们会被当文本归一化。'
    ).toBe(true)
  })

  it('never sounds a shell through exec/execSync, because Windows has no sh', () => {
    // 允许 `execFile` / `execFileSync` / `spawn`（它们不走 shell）；禁止把命令拼成字符串交给 shell，
    // 那条路在 Windows 上要 `cmd.exe` 语义，参数里的引号与 `&&` 全变样。
    // 判据看**导入**，不看调用处：`regex.exec(` 是正则方法，与子进程无关；第一版按 `exec(` 扫，
    // 一口气误报了十个文件，全是 `RegExp.exec`。`\bexec\b` 不会匹配 `execFile`（词边界后是字母）。
    const importsShellExec = /import\s*\{[^}]*\b(?:exec|execSync)\b[^}]*\}\s*from\s*['"]node:child_process['"]/u
    const offenders = productionSources()
      .filter((file) => importsShellExec.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).split(sep).join('/'))

    expect(
      offenders,
      `这些文件用了走 shell 的 exec/execSync（Windows 上没有 sh）：\n${offenders.map((file) => `  - ${file}`).join('\n')}\n` +
        '改成 execFile / execFileSync / spawn，参数用数组传。'
    ).toEqual([])
  })

  it('reads TEMP/TMP only in the one helper that probes writability', () => {
    // 系统临时目录在 Windows 上是继承会话环境的，可能指向进程建不出来的路径（`D:\tmp`）。
    // 允许读它的只有一个地方：`ensureWritableTempDirectory` 的调用方（探针 + 改写到 userData 兜底）。
    const allowed = new Set([
      'platform/desktop/main/ensureWritableTempDirectory.ts',
      'platform/desktop/main/composition/platformCore.ts'
    ])
    const offenders = productionSources()
      .filter((file) => /process\.env\.(TEMP|TMP)\b/u.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).split(sep).join('/'))
      .filter((path) => !allowed.has(path))

    expect(
      offenders,
      `这些地方直接读 TEMP/TMP，绕过了可写性探针：\n${offenders.map((file) => `  - ${file}`).join('\n')}`
    ).toEqual([])
  })

  it('keeps tracked paths legal on Windows: no case-only twins, no reserved names, no trailing dot or space', () => {
    // 三种都会在 Windows 上翻车：① 仅大小写不同的两个文件在那台机器上是同一个（Linux 上却是两个）；
    // ② `con`/`nul`/`aux`/`com1`… 是设备名，建不出来；③ 结尾的点或空格会被系统吃掉，路径随之改变。
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter((path) => path !== '')

    const lowered = new Map<string, string[]>()
    for (const path of tracked) {
      const key = path.toLowerCase()
      lowered.set(key, [...(lowered.get(key) ?? []), path])
    }
    const caseTwins = [...lowered.values()].filter((paths) => paths.length > 1).map((paths) => paths.join(' / '))

    const reserved = /(^|\/)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|\/|$)/iu
    const reservedHits = tracked.filter((path) => reserved.test(path))
    const trailing = tracked.filter((path) => path.split('/').some((part) => /[. ]$/u.test(part)))

    expect(
      { caseTwins, reservedHits, trailing },
      '这些跟踪路径在 Windows 上不合法：\n' +
        `仅大小写不同：${caseTwins.join(', ') || '无'}\n` +
        `Windows 设备名：${reservedHits.join(', ') || '无'}\n` +
        `结尾的点或空格：${trailing.join(', ') || '无'}`
    ).toEqual({ caseTwins: [], reservedHits: [], trailing: [] })
  })
})
