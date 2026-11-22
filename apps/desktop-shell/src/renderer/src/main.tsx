import React from 'react'
import { createRoot } from 'react-dom/client'
import 'antd/dist/reset.css'

// Design tokens first: every stylesheet below reads them. Kept as a module import rather than a
// CSS `@import` so the path goes through the `@platform` alias and survives a directory move.
import '@platform/ui/tokens/tokens.css'
// 行内文字动作（句子里的「重试」这类）：属于平台样式层，随 token 一起全局加载。
import '@platform/ui/styles/textAction.css'
// antd 静态方法（确认框、提示消息、通知）在 React 19 下要显式接上渲染器，否则静默不显示。
import { installAntdStaticRender } from '@platform/ui/antd/antdStaticRender'

import { productWindowEntries } from '@products/generated/shellRegistry'

import { AppShell } from './shell/AppShell'
import { markRendererBoot } from './shell/bootMarks'
import { markRendererPlatform } from './shell/window/windowPlatform'
import './styles.css'

/**
 * 平台标记只给样式/窗口分叉用：渲染层拿不到 `process.platform`，读 UA 即可（判定与写入口径
 * 都在 `shell/window/windowPlatform.ts`，CSS 的滚动条/自绘标题栏让位与 React 的窗口按钮读同一处）。
 */
markRendererPlatform()
installAntdStaticRender()

const root = createRoot(document.getElementById('root') as HTMLElement)

/**
 * 一次性窗口（主进程要在一张图上渲染某个产品页面时用，第一个就是日报海报）。
 *
 * 约定：`?window=poster&product=<id>&entry=<id>` 选中产品声明的某个窗口入口，模块的默认导出
 * 拿 `{params}` 自己渲染。这里**不认任何产品名**，也不 import 产品代码——入口由生成器产出。
 * 找不到入口就写失败标记后什么都不画：主进程据此记一次失败，而不是等满 15s 才发现是空窗口。
 */
function posterWindowRequest(params: URLSearchParams): Readonly<{ product: string; entry: string }> | null {
  if (params.get('window') !== 'poster') return null
  const product = params.get('product') ?? ''
  const entry = params.get('entry') ?? ''
  if (product === '' || entry === '') return null
  return { product, entry }
}

function markPosterFailure(reason: string): void {
  document.documentElement.dataset.posterState = 'failed'
  document.documentElement.dataset.posterError = reason
}

const posterRequest = posterWindowRequest(new URLSearchParams(window.location.search))

if (posterRequest === null) {
  root.render(
    <React.StrictMode>
      <AppShell />
    </React.StrictMode>
  )
} else {
  const wanted = `${posterRequest.product}.${posterRequest.entry}`
  const contribution = productWindowEntries.find((entry) => entry.id === wanted)
  if (contribution === undefined) {
    markPosterFailure('entry-not-found')
  } else {
    void contribution.load().then((loaded: unknown) => {
      const Poster = (loaded as { default?: unknown }).default
      if (typeof Poster !== 'function') {
        markPosterFailure('entry-has-no-component')
        return
      }
      const Component = Poster as (props: { params: URLSearchParams }) => React.ReactElement | null
      const params = new URLSearchParams(window.location.search)
      root.render(<Component params={params} />)
    }).catch(() => {
      markPosterFailure('entry-load-failed')
    })
  }
}

// 纯观测：两帧之后才算「第一帧已经画到屏幕上」（单帧还在布局之前）。删掉不影响渲染。
// 同一时机移除内联首屏占位：它只负责「别让窗口一片空」，第一帧画出来就该退场。
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    markRendererBoot('first-frame')
    document.getElementById('boot-splash')?.remove()
  })
)
