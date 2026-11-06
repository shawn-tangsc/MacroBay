import { describe, expect, it } from 'vitest'

import {
  aliasRulesFromTsconfigPaths,
  candidatePaths,
  describeUnresolved,
  findUnresolvedImports,
  parseImportSpecifiers,
  resolveSpecifier
} from './headTreeImports'

const ALIASES = aliasRulesFromTsconfigPaths({ '@platform/*': ['platform/*'], '@products/*': ['products/*'] })

describe('parseImportSpecifiers', () => {
  it('取四种写法，且带出行号', () => {
    const source = [
      "import { a } from './a'",
      "export { b } from './b'",
      "const c = await import('./c')",
      "const d = require('./d')"
    ].join('\n')
    expect(parseImportSpecifiers('f.ts', source)).toEqual([
      { file: 'f.ts', line: 1, specifier: './a' },
      { file: 'f.ts', line: 2, specifier: './b' },
      { file: 'f.ts', line: 3, specifier: './c' },
      { file: 'f.ts', line: 4, specifier: './d' }
    ])
  })

  it('查询串不是路径的一部分', () => {
    // 打包器的 `?raw` / `?url` 会让同一个文件在两种解析下都不在文件表里，去掉才判得准。
    expect(parseImportSpecifiers('f.tsx', "import s from './note.md?raw'")).toEqual([
      { file: 'f.tsx', line: 1, specifier: './note.md' }
    ])
  })

  it('把源码当证据断言的用例不算引用（否则每次跑都是一片假 red）', () => {
    const source = [
      'expect(windowHostSource).toContain("from \'../../window/rendererProcessDiagnostics\'")',
      "expect(shell).toContain('import(\"../sample-addon/desktop/panels/inspector\")')",
      "expect(page).toContain(\"from '../../features/macro/economic-calendar'\")"
    ].join('\n')
    expect(parseImportSpecifiers('f.test.ts', source)).toEqual([])
  })

  it('模板字面量拼出来的路径不判', () => {
    const line = '.map((p) => `import { x } from \'../${p.id}/product.manifest\'`)'
    expect(parseImportSpecifiers('gen.ts', line)).toEqual([])
  })
})

describe('resolveSpecifier', () => {
  it('相对路径按引用方所在目录解析，并考虑 index', () => {
    expect(candidatePaths('platform/ui/components/popover')).toContain(
      'platform/ui/components/popover/index.ts'
    )
    const candidates = resolveSpecifier('platform/ui/a.ts', './components/popover', ALIASES)
    expect(candidates).toContain('platform/ui/components/popover/index.tsx')
  })

  it('别名按 tsconfig 的映射解析，且长前缀优先', () => {
    const rules = aliasRulesFromTsconfigPaths({ '@a/*': ['one/*'], '@a/b/*': ['two/*'] })
    expect(resolveSpecifier('x.ts', '@a/b/c', rules)).toEqual(candidatePaths('two/c'))
    expect(resolveSpecifier('x.ts', '@platform/notifications/store', ALIASES)).toEqual(
      candidatePaths('platform/notifications/store')
    )
  })

  it('外部包不判（交给包管理器）', () => {
    expect(resolveSpecifier('x.ts', 'vitest', ALIASES)).toBeNull()
    expect(resolveSpecifier('x.ts', 'node:fs', ALIASES)).toBeNull()
  })

  it('ESM 风格写 .js，实际文件是 .ts', () => {
    expect(candidatePaths('platform/a')).toContain('platform/a.ts')
    expect(candidatePaths('platform/a.js')).toContain('platform/a.ts')
  })
})

describe('findUnresolvedImports', () => {
  const tracked = new Set([
    'platform/ui/kept.ts',
    'platform/ui/folder/index.ts',
    'products/mi/service/notifier.ts'
  ])

  it('引用了只在磁盘上的新文件 → 报出来（今晚这个形状发生了三次）', () => {
    const imports = parseImportSpecifiers(
      'products/mi/service/module.ts',
      "import { x } from './notifier'\nimport { y } from './newsFallback'"
    )
    expect(findUnresolvedImports(imports, tracked, ALIASES)).toEqual([
      { file: 'products/mi/service/module.ts', line: 2, specifier: './newsFallback' }
    ])
  })

  it('指向目录时，index 在库里就算解析得上', () => {
    const imports = parseImportSpecifiers('platform/ui/a.ts', "import { k } from './folder'")
    expect(findUnresolvedImports(imports, tracked, ALIASES)).toEqual([])
  })

  it('别名解析得上时不报，解析不上时报', () => {
    const ok = parseImportSpecifiers('x.ts', "import { k } from '@platform/ui/kept'")
    expect(findUnresolvedImports(ok, tracked, ALIASES)).toEqual([])
    const broken = parseImportSpecifiers('x.ts', "import { k } from '@platform/ui/gone'")
    expect(findUnresolvedImports(broken, tracked, ALIASES)).toHaveLength(1)
  })

  it('外部包不进结果', () => {
    const imports = parseImportSpecifiers('x.ts', "import { useState } from 'react'")
    expect(findUnresolvedImports(imports, tracked, ALIASES)).toEqual([])
  })

  it('报错句写清怎么办，而不是只有一条路径', () => {
    const [offender] = findUnresolvedImports(
      parseImportSpecifiers('products/mi/service/module.ts', "import { y } from './newsFallback'"),
      tracked,
      ALIASES
    )
    expect(describeUnresolved(offender!)).toContain('git add -N')
  })
})
