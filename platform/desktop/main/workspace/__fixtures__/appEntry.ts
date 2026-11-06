import { join, parse } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 测试专用：一个**两个平台都合法**的应用入口地址。
 *
 * 不能把 `file:///app/renderer` 写成固定值。那是「POSIX 根目录下的 app」这种形状，在 Windows 上
 * `fileURLToPath` 对**没有盘符**的 file URL 直接抛错，入口判定于是按非法入口 fail closed，
 * 四五条用例会以 `detached-window-entry-rejected` 红掉——而产品逻辑其实是对的：
 * 真机入口永远带盘符。详见
 * `docs-private/10-development/pitfalls/2026-10-27-file-entry-must-use-the-native-path-rule.md`
 * （那一节写的正是「fixtures 用了 file:///app/renderer，Windows 上没有盘符所以抛错」）。
 *
 * 从宿主根目录派生，形状随平台变、含义不变：
 * macOS ⇒ `file:///app/renderer`，Windows ⇒ `file:///C:/app/renderer`。
 */
const APP_ROOT_PATH = join(parse(process.cwd()).root, 'app', 'renderer')

/** 应用根（`createPanelDetachedWindowHost` / `createDetachedWindowFactory` 的 `appRoot`）。 */
export const APP_ROOT = pathToFileURL(APP_ROOT_PATH).href

/** 入口页（同一个根下的 `index.html`）。 */
export const ENTRY = pathToFileURL(join(APP_ROOT_PATH, 'index.html')).href
