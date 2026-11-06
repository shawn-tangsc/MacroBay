import { describe, expect, it, vi } from 'vitest'

/**
 * 窗口接线：失败页要真的加载进窗口，而不是只在测试里生成一段 HTML。
 * 这里用假窗口验证三件事——页面被 loadURL 加载、三个动作被接管、动作不会漏到真实导航。
 */
const quit = vi.fn()
const relaunch = vi.fn()
const exit = vi.fn()
const openPath = vi.fn(async () => '')

/**
 * 两平台都成立的真实 userData 形状。固定值不能只写 macOS 那一种：失败页上的日志路径是按
 * `process.platform` 换形态的（macOS `~/Library/…`、Windows `%APPDATA%\…`），只写一种，
 * 等于「家目录被折叠、用户名不出现」这条只在一种平台上被测过。
 */
const USER_DATA = process.platform === 'win32'
  ? 'C:\\Users\\alice\\AppData\\Roaming\\MacroBay'
  : '/Users/alice/Library/Application Support/MacroBay'

/** 页面上应出现的日志路径：产品名取自 userData 倒数第二段，形态由平台决定。 */
const DISPLAYED_LOG_PATH = process.platform === 'win32'
  ? '%APPDATA%\\MacroBay\\logs\\app.log'
  : process.platform === 'darwin'
    ? '~/Library/Application Support/MacroBay/logs/app.log'
    : '~/.config/MacroBay/logs/app.log'

vi.mock('electron', () => ({
  app: {
    getPath: () => USER_DATA,
    getLocale: () => 'zh-CN',
    quit,
    relaunch,
    exit
  },
  shell: { openPath }
}))

const { showBootFailurePage } = await import('./bootFailureWindow')

function createFakeWindow() {
  const listeners = new Map<string, (event: { preventDefault: () => void }, url: string) => void>()
  const loaded: string[] = []
  const window = {
    webContents: {
      on: (event: string, handler: (event: { preventDefault: () => void }, url: string) => void) => {
        listeners.set(event, handler)
      },
      setWindowOpenHandler: () => undefined
    },
    loadURL: async (url: string) => {
      loaded.push(url)
    }
  }
  return { window, loaded, navigate: (url: string) => listeners.get('will-navigate')?.({ preventDefault: () => undefined }, url) }
}

const failure = {
  code: 'product-bootstrap-failed',
  stage: 'register-product-services',
  productId: 'market-intelligence',
  reason: 'Cannot find module \'…/products/market-intelligence/product.manifest.ts\''
}

describe('boot failure window wiring', () => {
  it('loads the failure page into the window as a self-contained data URL', async () => {
    const harness = createFakeWindow()
    showBootFailurePage(harness.window as never, failure)
    await Promise.resolve()

    expect(harness.loaded).toHaveLength(1)
    expect(harness.loaded[0].startsWith('data:text/html;charset=utf-8,')).toBe(true)
    const html = decodeURIComponent(harness.loaded[0].slice('data:text/html;charset=utf-8,'.length))
    expect(html).toContain('product-bootstrap-failed')
    expect(html).toContain('market-intelligence')
    // 屏幕上没有家目录、也没有用户名：日志路径换成 ~ / %APPDATA% 形式。
    expect(html).not.toContain('alice')
    expect(html).toContain(DISPLAYED_LOG_PATH)
  })

  it('routes the three page actions to the real ones and ignores foreign navigations', () => {
    const harness = createFakeWindow()
    showBootFailurePage(harness.window as never, failure)

    harness.navigate('macrobay-boot:quit')
    expect(quit).toHaveBeenCalledTimes(1)

    harness.navigate('macrobay-boot:logs')
    // 生产侧是用 `/logs` 拼的（不是 path.join），所以这里照抄同一条拼接方式。
    expect(openPath).toHaveBeenCalledWith(`${USER_DATA}/logs`)

    harness.navigate('https://example.com')
    // 不是我们的链接就原样交给窗口：这里只断言没有误触发任何动作。
    expect(quit).toHaveBeenCalledTimes(1)
    expect(relaunch).not.toHaveBeenCalled()
  })
})
