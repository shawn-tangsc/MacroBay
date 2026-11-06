import { describe, expect, it, vi } from 'vitest'

/**
 * 临时目录闸门：**开库之前必须先确认系统临时目录可写**。
 *
 * 守的是「顺序」，不是「函数对不对」：`ensureWritableTempDirectory` 早就有 5 条用例，但那些
 * 证明的是函数本身正确；当初的 bug 是**启动时先开了数据库、根本没走探针**（修法一开始写在
 * `app.ts`，撞行数上限才挪到 `platformCore`）。CI 机器的临时目录可写，正常跑永远走不到那条
 * 分支，所以这类「顺序错」在测试里是隐形的。
 *
 * 这里用 `vi.resetModules()` 取一份全新的模块实例——它的闸门是关着的——来模拟「装配没探过就开库」。
 * 不能依赖 setup 文件的状态，那个 setup 本来就会把闸门打开。
 */
/** The flag is process-wide (see the module's comment), so a test that wants it closed clears it. */
const clearFlag = (): void => { delete (globalThis as Record<symbol, unknown>)[Symbol.for('macrobay.storage.tempDirectoryVerified')] }

describe('sqlite temp-directory gate', () => {
  it('refuses to open a database before the probe has run', async () => {
    vi.resetModules()
    clearFlag()
    const fresh = await import('@platform/storage/sqlite/openSqliteDatabase')

    expect(() => fresh.openSqliteDatabase(':memory:')).toThrow('sqlite-temp-directory-not-verified')
  })

  it('opens once the probe has marked the temp directory writable', async () => {
    vi.resetModules()
    const fresh = await import('@platform/storage/sqlite/openSqliteDatabase')
    const readiness = await import('@platform/storage/sqlite/tempDirectoryReadiness')
    readiness.markTempDirectoryVerified()

    const database = fresh.openSqliteDatabase(':memory:')
    try {
      expect(database.prepare('select 1 as value').get()).toEqual({ value: 1 })
    } finally {
      database.close()
    }
  })

  it('shares one flag across import specifiers', async () => {
    // The seed script marked readiness through the package alias while the database opener read it
    // through another URL: under tsx those are two module instances. The flag therefore lives on a
    // process-wide symbol, and this pins the property that matters — one marks, the other sees it.
    vi.resetModules()
    clearFlag()
    const viaAlias = await import('@platform/storage/sqlite/tempDirectoryReadiness')
    const viaRelative = await import('./tempDirectoryReadiness')

    expect(viaRelative.isTempDirectoryVerified()).toBe(false)
    viaAlias.markTempDirectoryVerified()
    expect(viaRelative.isTempDirectoryVerified()).toBe(true)
    expect((await import('@platform/storage/sqlite/openSqliteDatabase')).openSqliteDatabase(':memory:')).toBeDefined()
  })

  it('keeps the composition root calling the probe before it marks readiness', async () => {
    // 运行时闸门保证「没探过不许开库」，这条补另一半：装配根确实**先**探、**再**标记。
    // 反过来写（先标记、后探）闸门就被绕过去了，而它不会抛错——只能靠这里看出来。
    vi.resetModules()
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('platform/desktop/main/composition/platformCore.ts', 'utf8')
    const probeAt = source.indexOf('ensureWritableTempDirectory({')
    const markAt = source.indexOf('markTempDirectoryVerified()')

    expect(probeAt, 'platformCore 里找不到探针调用').toBeGreaterThanOrEqual(0)
    expect(markAt, 'platformCore 里找不到闸门开启').toBeGreaterThanOrEqual(0)
    expect(probeAt, '闸门在探针之前就开了：顺序反了，等于没探').toBeLessThan(markAt)
  })
})
