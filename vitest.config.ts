import { resolve } from 'node:path'
import { configDefaults } from 'vitest/config'

/**
 * 测量型用例：断言的是「受控环境下的资源足迹」，不是功能对错。
 *
 * 和几百个功能用例挤在同一个并发池里时，量到的是机器的忙闲程度——同一提交第一次红、重跑就绿
 * （`marketCalendarEventRepository` 的 256MiB 足迹就这么红过）。它们单独成一个 project、串行跑：
 * 仍然是必过断言，只是不再和别人抢 CPU。
 *
 * 不许做的事：删掉、改成警告、把阈值调大。前两个丢掉信号，第三个改尺子。
 */
const MEASUREMENT_TESTS = [
  'products/market-intelligence/service/intelligence/macro-calendar/0xrouter-calendar/marketCalendarEventRepository.test.ts',
  'products/market-intelligence/service/intelligence/macro-calendar/0xrouter-calendar/marketCalendarStorageReclaim.test.ts',
  'products/market-intelligence/service/intelligence/macro-calendar/bls-ics-manual/blsManualIcsImportService.test.ts'
]

export default {
  resolve: {
    alias: {
      '@platform': resolve(__dirname, 'platform'),
      '@products': resolve(__dirname, 'products'),
      '@renderer': resolve(__dirname, 'apps/desktop-shell/src/renderer/src'),
      antd: resolve(__dirname, 'apps/desktop-shell/node_modules/antd'),
      dayjs: resolve(__dirname, 'apps/desktop-shell/node_modules/dayjs')
    }
  },
  test: {
    environment: 'node',
    // Session-slot behavior is defined in local wall-clock time; pin the test zone so a UTC
    // CI runner and a developer laptop produce the same assertions.
    env: { TZ: 'Asia/Shanghai' },
    // 组件基座的样式注入会排一次 requestAnimationFrame；node 环境没有它，崩在「换基座」这一步
    // 而不是业务断言上。补一次，供所有线共用（各线自己补就会长出七种写法）。
    setupFiles: [resolve(__dirname, 'tools/test-setup/domFramePolyfill.ts')],
    // 保持 5 秒。把它抬到 15 秒等于关掉今天唯一暴露问题的那盏灯：AppShell 的模块 import 从
    // 2.91 秒涨到 7.63 秒，正是被 5 秒默认值撑出来的；抬到 15 秒之后，同样的增长会静默通过。
    // 慢在「测量」上的用例（资源足迹、真实锁等待）进下面的串行池并自带显式超时，功能断言留在这里。
    testTimeout: 5_000,
    hookTimeout: 5_000,
    // 1269 files on one laptop: running them all at once starves the CPU, and the red set rotates —
    // 15 failures, then 4, then 1, different files each time, every one of them green when run
    // alone. Half the pool is both stable and faster (full suite: 166s green vs 288s with
    // failures), because the suite spends more time thrashing than working above that.
    maxWorkers: '50%',
    projects: [
      {
        extends: true,
        test: {
          name: 'functional',
          exclude: [...configDefaults.exclude, ...MEASUREMENT_TESTS]
        }
      },
      {
        extends: true,
        test: {
          name: 'measurement',
          include: MEASUREMENT_TESTS,
          // 串行：测量型用例要独占机器，否则量的是负载而不是代码。
          fileParallelism: false,
          maxWorkers: 1,
          // 这里的显式上限对应实测：256MiB 足迹用例单跑 16.9 秒、回收用例 39 秒级。
          testTimeout: 120_000,
          hookTimeout: 120_000
        }
      }
    ]
  }
}
