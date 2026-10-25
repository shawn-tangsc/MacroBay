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
    exclude: [...configDefaults.exclude]
  }
}
