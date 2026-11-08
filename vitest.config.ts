import { resolve } from 'node:path'
import { configDefaults } from 'vitest/config'

import { MEASUREMENT_TESTS } from './tools/test-setup/measurementTests'

export default {
  resolve: {
    alias: {
      '@platform': resolve(__dirname, 'platform'),
      '@products': resolve(__dirname, 'products'),
      '@renderer': resolve(__dirname, 'apps/desktop-shell/src/renderer/src'),
      // 与 electron.vite.config 的 `@resources` 保持一致：渲染层直接引打包用的那张图，不复制。
      '@resources': resolve(__dirname, 'resources'),
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
    setupFiles: [
      resolve(__dirname, 'tools/test-setup/domFramePolyfill.ts'),
      // 临时目录闸门：生产路径必须由 platformCore 先探可写；测试环境统一打开（见该文件注释）。
      resolve(__dirname, 'tools/test-setup/markTempDirectoryVerified.ts')
    ],
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
