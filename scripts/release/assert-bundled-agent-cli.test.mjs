import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { bundledCliProblems, machOArch } from './assert-bundled-agent-cli.mjs'

/**
 * 包内 CLI 架构断言的判据：**故意放一个错架构的 CLI 进去，必须红**；只有对的架构才绿。
 *
 * 这条断言存在的理由：runner 架构不等于产物架构。2026-11-19 本机构建 arm64 包时，包里同时出现了
 * arm64 与 x64 两份 `claude`——`hdiutil verify` 照样 VALID，只有真正读文件头才看得出来。
 */

const temporary = []
afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop(), { recursive: true, force: true })
})

/** 8 字节的 Mach-O 64 位小端头：magic + cputype。 */
function machO64(cpuType) {
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32LE(0xfeedfacf, 0)
  buffer.writeUInt32LE(cpuType, 4)
  return buffer
}

const ARM64 = 0x0100000c
const X86_64 = 0x01000007

function universal() {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(0xcafebabe, 0)
  header.writeUInt32BE(2, 4)
  const entries = Buffer.alloc(20 * 2)
  entries.writeUInt32BE(ARM64, 0)
  entries.writeUInt32BE(X86_64, 20)
  return Buffer.concat([header, entries])
}

/**
 * 造一个最小的 `MacroBay.app/Contents/Resources/…`，按 `variants` 放 `claude`。
 * `variants` 里的值决定二进制头，键是 `claude-agent-sdk-darwin-<键>`。
 */
function bundle(variants) {
  const root = mkdtempSync(join(tmpdir(), 'bundled-cli-'))
  temporary.push(root)
  const appPath = join(root, 'MacroBay.app')
  for (const [arch, bytes] of Object.entries(variants)) {
    const dir = join(appPath, 'Contents', 'Resources', 'app', 'node_modules', '@anthropic-ai', `claude-agent-sdk-darwin-${arch}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'claude'), bytes)
  }
  if (Object.keys(variants).length === 0) mkdirSync(join(appPath, 'Contents', 'Resources'), { recursive: true })
  return appPath
}

describe('machO parsing', () => {
  it('reads the two architectures we ship', () => {
    expect(machOArch(machO64(ARM64))).toBe('arm64')
    expect(machOArch(machO64(X86_64))).toBe('x64')
    expect(machOArch(universal())).toBe('universal')
    expect(machOArch(Buffer.from('not a binary'))).toBe('unknown')
  })
})

describe('bundled agent CLI must match the package architecture', () => {
  it('passes when the only CLI is the target architecture', () => {
    expect(bundledCliProblems({ appPath: bundle({ arm64: machO64(ARM64) }), arch: 'arm64' })).toEqual([])
    expect(bundledCliProblems({ appPath: bundle({ x64: machO64(X86_64) }), arch: 'x64' })).toEqual([])
  })

  it('fails when an x64 CLI is sitting inside an arm64 package', () => {
    const problems = bundledCliProblems({
      appPath: bundle({ arm64: machO64(ARM64), x64: machO64(X86_64) }),
      arch: 'arm64'
    })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('claude-agent-sdk-darwin-x64/claude: x64, expected arm64')
  })

  it('fails when the vendor directory says arm64 but the binary is x64', () => {
    const problems = bundledCliProblems({ appPath: bundle({ arm64: machO64(X86_64) }), arch: 'arm64' })

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('x64, expected arm64')
  })

  it('fails when the package carries no agent CLI at all', () => {
    expect(bundledCliProblems({ appPath: bundle({}), arch: 'arm64' })).toEqual([
      expect.stringContaining('no claude-agent-sdk-darwin-*/claude found')
    ])
  })

  it('fails when the app bundle itself is missing', () => {
    expect(bundledCliProblems({ appPath: join(tmpdir(), 'no-such-app'), arch: 'arm64' })).toEqual([
      expect.stringContaining('cannot read')
    ])
  })

  it('accepts a universal binary as both targets', () => {
    expect(bundledCliProblems({ appPath: bundle({ arm64: universal() }), arch: 'arm64' })).toEqual([])
    expect(bundledCliProblems({ appPath: bundle({ x64: universal() }), arch: 'x64' })).toEqual([])
  })
})
