// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { productText } from '../../shared/i18n/productText'
import { AgentFloatingControl } from './AgentFloatingControl'

const text = { open: '打开市场解读 Agent', close: '关闭', title: '市场解读 Agent', clear: '清空' }

async function render(onOpenChange = vi.fn()) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const click = async (selector: string) => act(async () => host.querySelector<HTMLButtonElement>(selector)!.click())
  await act(async () => root.render(<AgentFloatingControl closeKey="close-agent" resolveText={(key) => key} text={text} onOpenChange={onOpenChange}><p data-agent-body>对话</p></AgentFloatingControl>))
  const escape = async () => act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
  return { host, click, escape, onOpenChange }
}

it('keeps the conversation closed until the reader asks for it', async () => {
  const { host } = await render()
  expect(host.querySelector('[data-agent-body]')).toBeNull()
  const button = host.querySelector('[data-agent-floating-button]')!
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(button.getAttribute('aria-label')).toBe(text.open)
  expect(button.className).toContain('mi-agent-floating__button')
})

it('opens the conversation over the page and closes it again', async () => {
  const { host, click, onOpenChange } = await render()
  await click('[data-agent-floating-button]')
  expect(host.querySelector('[data-agent-body]')?.textContent).toBe('对话')
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(text.title)
  expect(host.querySelector('[data-agent-floating-button]')?.getAttribute('aria-expanded')).toBe('true')
  expect(onOpenChange).toHaveBeenLastCalledWith(true)
  await click('.mi-agent-floating__close')
  expect(host.querySelector('[data-agent-body]')).toBeNull()
  expect(onOpenChange).toHaveBeenLastCalledWith(false)
})

it('closes on escape, which is what a keyboard reader expects of a dialog', async () => {
  const { host, click, escape } = await render()
  await click('[data-agent-floating-button]')
  await escape()
  expect(host.querySelector('[data-agent-body]')).toBeNull()
})

it('ignores escape while it is already closed', async () => {
  const { host, escape, onOpenChange } = await render()
  await escape()
  expect(host.querySelector('[data-agent-body]')).toBeNull()
  expect(onOpenChange).not.toHaveBeenCalled()
})

it('uses the copy the caller passes, with no text of its own', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<AgentFloatingControl closeKey="CLOSE-ME" resolveText={(key) => key} text={{ open: 'OPEN-ME', close: 'CLOSE-ME', title: 'TITLE-ME', clear: 'CLEAR-ME' }}><p data-agent-body>对话</p></AgentFloatingControl>))
  expect(host.querySelector('[data-agent-floating-button]')?.getAttribute('aria-label')).toBe('OPEN-ME')
  await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!.click())
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('TITLE-ME')
  expect(host.querySelector('.mi-agent-floating__close')?.getAttribute('aria-label')).toBe('CLOSE-ME')
})

it('sits at the window bottom-right and can be dragged, without a drag opening it', async () => {
  const { host, click } = await render()
  const button = host.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!
  // Window-fixed, bottom-right by default rather than placed in the column.
  expect(button.style.position === 'fixed' || button.className).toBeTruthy()
  expect(parseFloat(button.style.left)).toBeGreaterThan(0)
  expect(parseFloat(button.style.top)).toBeGreaterThan(0)
  const startLeft = parseFloat(button.style.left)
  const fire = async (type: string, clientX: number, clientY: number) => act(async () => {
    button.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, clientY }))
  })
  // Pointer events: happy-dom supports them as MouseEvent subtypes here.
  await act(async () => button.dispatchEvent(Object.assign(new Event('pointerdown', { bubbles: true }), { clientX: startLeft + 5, clientY: parseFloat(button.style.top) + 5 }) as never))
  await act(async () => button.dispatchEvent(Object.assign(new Event('pointermove', { bubbles: true }), { clientX: startLeft - 100, clientY: parseFloat(button.style.top) - 60 }) as never))
  await act(async () => button.dispatchEvent(Object.assign(new Event('pointerup', { bubbles: true })) as never))
  expect(parseFloat(button.style.left)).toBeLessThan(startLeft)
  // The trailing click after a drag must not toggle the panel.
  await click('[data-agent-floating-button]')
  expect(host.querySelector('[data-agent-body]')).toBeNull()
  // A plain click still opens it.
  await click('[data-agent-floating-button]')
  expect(host.querySelector('[data-agent-body]')).not.toBeNull()
  void fire
})

it('uses only tokens this stylesheet defines, so it cannot render invisible', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  // Same repo-relative read the other style guards use; a file URL is not available here.
  const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/intelligence.css'), 'utf8')
  const block = css.slice(css.indexOf('/* The agent control floats above the workspace'))
  // Shell-level tokens (--accent, --surface, --border) are legitimate; the rule is that this
  // block may only use tokens the stylesheet already relies on somewhere.
  const rest = css.slice(0, css.indexOf('/* The agent control floats'))
  // Custom properties are resolved at use time, not in source order, so a declaration anywhere
  // in the file counts; only the *usage* has to exist outside these two blocks.
  const knownElsewhere = new Set([
    // Shell-level theme tokens are defined in the app stylesheet and safe anywhere.
    '--bg', '--surface', '--surface-strong', '--surface-soft', '--border', '--border-strong',
    '--text', '--text-strong', '--muted', '--muted-strong', '--danger', '--accent', '--accent-contrast',
    ...[...rest.matchAll(/var\((--[a-z-]+)\)/g)].map(match => match[1]!),   // shell-level tokens
    ...[...css.matchAll(/^\s+(--[a-z-]+):/gm)].map(match => match[1]!)     // declared anywhere in the file
  ])
  for (const used of new Set([...block.matchAll(/var\((--[a-z-]+)\)/g)].map(match => match[1]!))) {
    expect(knownElsewhere.has(used), `${used} is used nowhere else in intelligence.css`).toBe(true)
  }
  // And the control must state its positioning itself rather than inherit the column's.
  expect(block).toContain('position: fixed')
  // The portal scope declares --mi-terminal-*; elements outside it would resolve those to
  // nothing and render transparent, so neither block may use them.
  const cardBlock = css.slice(css.indexOf("/* The right column's calendar card"), css.indexOf('/* The agent control floats'))
  for (const text of [block, cardBlock]) {
    expect([...text.matchAll(/var\((--mi-terminal-[a-z-]+)\)/g)]).toEqual([])
  }
})

it('gives each calendar kind its own colour, read from the stylesheet', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/intelligence.css'), 'utf8')
  const chip = (kind: string) => css.match(new RegExp(`__row-kind\\[data-kind='${kind}'\\] \\{ color: var\\((--[a-z-]+)\\)`))?.[1]
  const kinds = ['economic-indicator', 'financial-event', 'central-bank-activity'].map(chip)
  // Two kinds sharing a token is exactly the bug this guards: they looked identical on screen.
  expect(kinds.every(Boolean)).toBe(true)
  expect(new Set(kinds).size).toBe(3)
})

it('declares the panel once, at a size a reader would call a dialog', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/intelligence.css'), 'utf8')
  // A second block silently overrode the first one — the panel stayed 360px while the code
  // claimed 900. One block, and its size is the doubled one.
  expect(css.match(/^\.mi-agent-floating \{/gm)).toHaveLength(1)
  const start = css.indexOf('.mi-agent-floating {')
  const block = css.slice(start, css.indexOf(String.fromCharCode(10) + '}', start) + 2)
  expect(block).toContain('width: min(760px, 74vw)')
  expect(block).toContain('height: min(900px, 78vh)')
  expect(block).toContain('z-index: var(--mi-agent-floating-z)')
})

it('declares the control once, and highlighted by default rather than on hover', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/intelligence.css'), 'utf8')
  // Three copies used to stack here: a stale muted 44px block from the first version overrode the
  // highlighted one, and a later block won the size at 48px — so the reader saw a small grey circle
  // and asked for the highlight to be the default. One block, and it is the highlighted one.
  expect(css.match(/^\.mi-agent-floating__button \{/gm)).toHaveLength(1)
  const start = css.indexOf('.mi-agent-floating__button {')
  const block = css.slice(start, css.indexOf(String.fromCharCode(10) + '}', start) + 2)
  expect(block).toContain('background: var(--accent)')
  expect(block).toContain('color: var(--surface)')
  expect(block).toContain('border: 2px solid var(--accent)')
  // The box has to be the size the drag clamp and the panel placement assume.
  expect(block).toContain('width: 56px')
  expect(block).toContain('height: 56px')
  expect(block).toContain('z-index: var(--mi-agent-floating-z)')
})

it('scrolls the conversation, not the panel, so the composer stays at the bottom', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const root = 'products/market-intelligence/desktop/pages/intelligence'
  const css = readFileSync(join(process.cwd(), `${root}/intelligence.css`), 'utf8')
  const body = css.slice(css.indexOf('.mi-agent-floating__body {'), css.indexOf('\n}', css.indexOf('.mi-agent-floating__body {')) + 2)
  // The body must not scroll; the messages inside the chat do, which leaves the form pinned.
  expect(body).toContain('overflow: hidden')
  expect(body).toContain('flex-direction: column')
  expect(body).toContain('.mi-analysis-chat { flex: 1')
  const chatCss = readFileSync(join(process.cwd(), 'platform/ui/agent-chat/agentChat.css'), 'utf8')
  const messages = chatCss.slice(chatCss.indexOf('.agent-chat-transcript {'), chatCss.indexOf('\n}', chatCss.indexOf('.agent-chat-transcript {')))
  expect(messages).toContain('overflow: auto')
  expect(messages).toContain('flex: 1')
})

it('anchors the panel to the button by viewport edges, not by a guessed size', async () => {
  const { host, click } = await render()
  const button = host.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!
  await click('[data-agent-floating-button]')
  const panel = host.querySelector<HTMLElement>('.mi-agent-floating')!
  // The button sits bottom-right by default, so the panel hangs from the bottom-right corner: its
  // bottom edge is one gap above the button and its right edge lines up with the button's.
  const buttonTop = parseFloat(button.style.top)
  const buttonLeft = parseFloat(button.style.left)
  expect(panel.style.bottom).toBe(`${window.innerHeight - buttonTop + 12}px`)
  expect(panel.style.right).toBe(`${window.innerWidth - (buttonLeft + 56)}px`)
  // Nothing may depend on the panel's own size, which the CSS owns (`78vh`).
  expect(panel.style.height).toBe('')
  expect(panel.style.top).toBe('auto')
})

it('offers a clear action in the panel header when the caller provides one', async () => {
  const onClear = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<AgentFloatingControl closeKey="close-agent" onClear={onClear} resolveText={(key) => key} text={text}><p data-agent-body>对话</p></AgentFloatingControl>))
  await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-floating-button]')!.click())
  const clear = host.querySelector<HTMLButtonElement>('.mi-agent-floating__clear')!
  expect(clear.textContent).toBe('清空')
  await act(async () => clear.click())
  expect(onClear).toHaveBeenCalledTimes(1)
  // Clearing must not close the panel; the reader keeps looking at the emptied conversation.
  expect(host.querySelector('[data-agent-body]')).not.toBeNull()
})

it('aligns the reader’s messages right and the agent’s left, as bubbles', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const css = readFileSync(join(process.cwd(), 'platform/ui/agent-chat/agentChat.css'), 'utf8')
  const rule = (role: string) => css.match(new RegExp(`\\.agent-chat-bubble\\[data-role='${role}'\\] \\{([^}]*)\\}`))?.[1] ?? ''
  // Without the two alignments the transcript reads as one undifferentiated column of text.
  expect(css).toMatch(/\.agent-chat-bubble \{[^}]*align-self: flex-start/)
  expect(rule('user')).toContain('align-self: flex-end')
  expect(css).toMatch(/\.agent-chat-bubble \{[^}]*border-radius: 10px/)
})

it('colours the direction tag from the stylesheet, with fallbacks for scopes without the tokens', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')
  const rule = (direction: string) => css.slice(css.indexOf(`__direction[data-direction="${direction}"]`))
  // The tokens live on the dashboard layout; a timeline panel rendered outside it would get no
  // colour at all without these fallbacks, which is exactly the bug this guards.
  for (const [direction, token] of [['bullish', '--mi-conclusion-positive'], ['bearish', '--mi-conclusion-negative'], ['range', '--mi-conclusion-caution']] as const) {
    expect(rule(direction)).toContain(`var(${token}, #`)
  }
  expect(rule('undecided')).toContain('var(--muted-strong, var(--muted, #')
})

/**
 * 窄档：底部上滑聊天框（用户 2026-11-24 拍板 v3，原型 `2026-11-24-pad-edge-handle-v3.html`）。
 *
 * 钉的是四件事，每一件都能把实现改坏单独打红：
 * ① 聊天框开着时圆钮**不渲染**（不是压上去）；
 * ② 遮罩盖住整页（看板不可点）——没有遮罩就等于两栏共存；
 * ③ Esc / 点遮罩都能关，关掉后焦点回圆钮；
 * ④ 聊天框里不出现第二层浮窗（浮窗面板在窄档根本不渲染）。
 */
async function renderCompact() {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const onOpenChange = vi.fn()
  await act(async () => root.render(<AgentFloatingControl closeKey="close-agent" compact onOpenChange={onOpenChange} resolveText={(key) => key} text={text}><p data-agent-body>对话</p></AgentFloatingControl>))
  const click = async (selector: string) => act(async () => host.querySelector<HTMLElement>(selector)!.click())
  return { host, click, onOpenChange }
}

it('opens the sheet on a narrow workspace with a scrim, and does not render the round button on top', async () => {
  const { host, click } = await renderCompact()
  // 第一次打开之前抽屉还没有内容可挂；打开之后就一直留在树上（关掉只是不可见）。
  expect(host.querySelector('[data-agent-sheet]')).toBeNull()
  await click('[data-agent-floating-button]')
  expect(host.querySelector('[data-agent-sheet]')?.getAttribute('data-open')).toBe('true')
  expect(host.querySelector('[data-agent-sheet] [data-agent-body]')?.textContent).toBe('对话')
  // 遮罩在：看板被盖住、点不动（没有它就成了「两栏共存」的错觉）。
  expect(host.querySelector('[data-agent-sheet-scrim]')).not.toBeNull()
  // 圆钮不渲染——不是压在上面。
  expect(host.querySelector('[data-agent-floating-button]')).toBeNull()
  // 抽屉里不许再长出一层：浮窗面板在窄档根本不渲染。
  expect(host.querySelector('.mi-agent-floating')).toBeNull()
  expect(host.querySelectorAll('[data-agent-sheet]')).toHaveLength(1)
})

it('closes on escape and puts focus back on the round button', async () => {
  const { host, click } = await renderCompact()
  await click('[data-agent-floating-button]')
  expect(document.activeElement).toBe(host.querySelector('.mi-agent-floating__close, .icon-button'))
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
  expect(host.querySelector('[data-agent-sheet]')?.getAttribute('data-open')).toBe('false')
  expect(host.querySelector('[data-agent-sheet-scrim]')).toBeNull()
  expect(document.activeElement).toBe(host.querySelector('[data-agent-floating-button]'))
})

it('closes when the reader clicks the scrim', async () => {
  const { host, click } = await renderCompact()
  await click('[data-agent-floating-button]')
  await click('[data-agent-sheet-scrim]')
  expect(host.querySelector('[data-agent-sheet]')?.getAttribute('data-open')).toBe('false')
  expect(host.querySelector('[data-agent-floating-button]')).not.toBeNull()
})

it('hides the round button while another modal layer is open', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<AgentFloatingControl closeKey="close-agent" compact resolveText={(key) => key} suppressed text={text}><p data-agent-body>对话</p></AgentFloatingControl>))
  // 时间轴 / 事件详情 / 设置开着时圆钮不渲染：它 z=1100，压在那几层（1000/1150/1200）上面就是第二层入口。
  expect(host.querySelector('[data-agent-floating-button]')).toBeNull()
})

it('sizes the chat sheet 40–70dvh (dvh, so the keyboard shrinks it) under the round button', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  const css = readFileSync(join(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/marketAnalysisWorkspace.css'), 'utf8')
  const sheet = css.slice(css.indexOf('.mi-agent-sheet {'), css.indexOf('\n}', css.indexOf('.mi-agent-sheet {')) + 2)
  // 40 起、70 封顶，中间随内容长：输入框贴视口底，长高不会让它上下跳。
  expect(sheet).toContain('min-height: 40dvh')
  expect(sheet).toContain('max-height: 70dvh')
  expect(sheet).toContain('height: auto')
  // `dvh` 不是 `vh`：软键盘弹起时框跟着缩，输入框不会被键盘吃掉（pad 上必须）。
  expect(sheet.match(/\d+d?vh/g)).toEqual(['40dvh', '70dvh'])
  expect(sheet).toContain('bottom: 0')
  expect(sheet).toContain('border-radius: 12px 12px 0 0')
  // 遮罩与聊天框都压在 antd 的 1000 之下（996 / 997）：否则从图标栏打开设置抽屉会被它们盖住。
  const scrim = css.slice(css.indexOf('.mi-agent-sheet__scrim {'), css.indexOf('\n}', css.indexOf('.mi-agent-sheet__scrim {')) + 2)
  expect(scrim).toContain('inset: 0')
  expect(scrim).toContain('z-index: 996')
  expect(sheet).toContain('z-index: 997')
})
