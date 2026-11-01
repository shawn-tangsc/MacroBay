import { resolve } from 'node:path'
import { configDefaults } from 'vitest/config'

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
    // Twelve hundred files share one machine, and the slowest case here waits on a real SQLite
    // lock (5.3s on its own). The 5s default then failed on load rather than on behaviour — every
    // file that tripped it passed when run alone. Raise the ceiling in this one place instead of
    // keeping a per-file exemption list: a list only grows, and it turns "green" into "green
    // except the list".
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // 1269 files on one laptop: running them all at once starves the CPU, and the red set rotates —
    // 15 failures, then 4, then 1, different files each time, every one of them green when run
    // alone. Half the pool is both stable and faster (full suite: 166s green vs 288s with
    // failures), because the suite spends more time thrashing than working above that.
    maxWorkers: '50%',
    exclude: [...configDefaults.exclude]
  }
}
