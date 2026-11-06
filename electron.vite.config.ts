import react from '@vitejs/plugin-react-swc'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@platform': resolve(__dirname, 'platform'),
        '@products': resolve(__dirname, 'products')
      }
    },
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: resolve(__dirname, 'apps/desktop-shell/src/main.ts'),
        // Optional runtime deps: resolved by Node at launch, not bundled by Vite.
        external: [
          '@anthropic-ai/claude-agent-sdk',
          '@anthropic-ai/claude-code',
          '@modelcontextprotocol/client',
          '@modelcontextprotocol/client/stdio',
          '@modelcontextprotocol/sdk/client/index.js',
          '@modelcontextprotocol/sdk/client/stdio.js',
          '@modelcontextprotocol/sdk/client/sse.js',
          '@modelcontextprotocol/sdk/client/streamableHttp'
        ],
        output: {
          entryFileNames: 'index.js'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: resolve(__dirname, 'platform/desktop/preload/index.ts'),
        output: {
          entryFileNames: 'index.js',
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'apps/desktop-shell/src/renderer'),
    // `@resources` 在 renderer root 之外：dev server 要显式允许读这一段，否则 import 会被挡。
    server: { fs: { allow: [resolve(__dirname)] } },
    plugins: [react()],
    resolve: {
      alias: {
        // 与 tsconfig / vitest 的别名保持一致：`@renderer` = 渲染器源码根（renderer/src）。
        '@renderer': resolve(__dirname, 'apps/desktop-shell/src/renderer/src'),
        '@platform': resolve(__dirname, 'platform'),
        '@products': resolve(__dirname, 'products'),
        // 打包用的图标只有一份：渲染层直接引它，不复制第二份（两份必然有一天不一致）。
        '@resources': resolve(__dirname, 'resources'),
        antd: resolve(__dirname, 'apps/desktop-shell/node_modules/antd'),
        dayjs: resolve(__dirname, 'apps/desktop-shell/node_modules/dayjs'),
        'lucide-react': resolve(__dirname, 'apps/desktop-shell/node_modules/lucide-react')
      }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: resolve(__dirname, 'apps/desktop-shell/src/renderer/index.html')
      }
    }
  }
})
