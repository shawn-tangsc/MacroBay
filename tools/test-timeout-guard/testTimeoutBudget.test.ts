import { describe, expect, it } from 'vitest'

import config from '../../vitest.config'

/**
 * 测试预算不许被悄悄抬大。
 *
 * 为什么值得一条常驻用例：今晚有三条红都被同一句话解释过——「把 `testTimeout` 抬到 15 秒就好了」。
 * 每一条的真实原因是**用例等的是一个它控制不了的量**（不 await 的副作用、生产默认开关、1 秒存储期限），
 * 抬预算只会让红灯晚到，并且把「预算比机器还紧」这盏唯一能照亮问题的灯关掉。
 * 配置里那段注释写着不许抬，但注释拦不住任何人；这条用例让抬手变成 diff 里看得见的一行。
 *
 * 允许的例外只有一个方向：**测量型用例进串行池并显式声明自己的上限**（它量的就是绝对耗时，
 * 与功能断言分属两个池）。所以这里断言的是「默认池仍是 5 秒」，不是「全仓只有一个数」。
 */

const DEFAULT_POOL_TIMEOUT_MS = 5_000

type Project = { test?: { name?: string; testTimeout?: number; hookTimeout?: number } }

function projectsOf(value: unknown): Project[] {
  const test = (value as { test?: { projects?: Project[] } }).test
  return test?.projects ?? []
}

describe('测试预算', () => {
  it('默认池仍是 5 秒：抬它之前先问过那条用例到底在等什么', () => {
    const test = (config as { test: { testTimeout?: number; hookTimeout?: number } }).test
    expect(test.testTimeout).toBe(DEFAULT_POOL_TIMEOUT_MS)
    expect(test.hookTimeout).toBe(DEFAULT_POOL_TIMEOUT_MS)
  })

  it('测量型用例可以在自己的池里声明更大上限（那是它测量的对象）', () => {
    const measurement = projectsOf(config).find((project) => project.test?.name === 'measurement')
    expect(measurement).toBeDefined()
    expect(measurement?.test?.testTimeout).toBeGreaterThan(DEFAULT_POOL_TIMEOUT_MS)
  })
})
