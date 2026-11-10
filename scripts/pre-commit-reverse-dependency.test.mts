import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { programFiles } from './pre-commit-callers.mts'

/**
 * 反向依赖到底有没有让**类型错现形**——用真 tsc 证明，不靠读源码猜。
 *
 * 形状照 B4 事故：`Widget` 的 props 多了一个必填成员，`Caller` 还在用旧形状。
 * - 只把 `Widget` 放进程序（= 事故当下的钩子）：0 条错，坏的和没坏的一样绿；
 * - 把调用方 `Caller` 也放进去（= 修好后的钩子）：当场一条「参数缺必填成员」。
 *
 * 这就是「去掉 health 必须红」的最小复现：变的是被引用的类型，红的是没改过的调用方。
 */

const TSC = fileURLToPath(new URL('../node_modules/.bin/tsc', import.meta.url))
const WIDGET =
  'export type WidgetProps = { label: string }\nexport function widget(props: WidgetProps): string {\n  return props.label\n}\n'
const CALLER = "import { widget } from './Widget'\nexport const value = widget({})\n"

const temporary: string[] = []
afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop() as string, { recursive: true, force: true })
})

function project(files: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'pre-commit-reverse-'))
  temporary.push(dir)
  writeFileSync(join(dir, 'Widget.ts'), WIDGET)
  writeFileSync(join(dir, 'Caller.ts'), CALLER)
  writeFileSync(
    join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: []
      },
      files
    })
  )
  return dir
}

function typecheck(dir: string): { status: number; output: string } {
  const result = spawnSync(TSC, ['--noEmit', '-p', join(dir, 'tsconfig.json')], {
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' }
  })
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

describe('reverse dependencies make the breakage visible', () => {
  it('stays green when only the changed file is in the program', () => {
    const check = typecheck(project(['./Widget.ts']))

    expect(check.status).toBe(0)
    expect(check.output).not.toContain('error TS')
  })

  it('reports the caller that still uses the old shape once the caller is included', () => {
    const check = typecheck(project(['./Widget.ts', './Caller.ts']))

    expect(check.status).not.toBe(0)
    expect(check.output).toContain('Caller.ts')
    expect(check.output).toContain('TS2345')
  })

  it('puts the staged files, the callers and the ambient declarations into the program', () => {
    expect(
      programFiles({
        staged: ['a/Changed.ts'],
        callers: ['b/Caller.tsx'],
        ambient: ['types/globals.d.ts']
      })
    ).toEqual(['./a/Changed.ts', './b/Caller.tsx', './types/globals.d.ts'])
  })
})
