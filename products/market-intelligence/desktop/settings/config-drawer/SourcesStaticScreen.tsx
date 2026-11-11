import { Button } from 'antd'

/**
 * 「来源与采集」的**静态版式**（用户 2026-11-10：静态先做完、他看过再接旧值）。
 *
 * 形状照旧的「配置看板来源」抽屉：左列供应商行、右栏单源详情。**一行真数据都没有**：
 * 值全是占位，开关位置画**状态词**（静态阶段画一个能拨的开关就是假控件），两颗按钮画**禁用态**
 * （可访问名照有，点了没反应才叫假控件）。
 *
 * 静态占位清单在本文件底部 `STATIC_PROVIDERS`——**数据接入时连同这个文件一起删**。
 */
type StaticProvider = { id: string; name: string; capabilities: number; enabled: number; marker: 'none' | 'ring' | 'warn' | 'bad' }

/** 静态占位：数据接入时删除本清单。 */
const STATIC_PROVIDERS: readonly StaticProvider[] = [
  { id: 'bls', name: 'BLS 官方日历', capabilities: 1, enabled: 1, marker: 'ring' },
  { id: 'fed', name: 'Fed 官方日历', capabilities: 1, enabled: 1, marker: 'warn' },
  { id: 'router', name: '0xRouter 市场日历', capabilities: 2, enabled: 2, marker: 'none' },
  { id: 'binance', name: 'Binance 期货持仓', capabilities: 1, enabled: 0, marker: 'bad' }
]

export function SourcesStaticScreen(): React.ReactElement {
  const selected = STATIC_PROVIDERS[0]!
  return (
    <div className="config-drawer__split" data-drawer-screen="ready" data-drawer-screen-name="sources">
      <div className="config-drawer__source-list">
        {STATIC_PROVIDERS.map((provider, index) => (
          <div
            className="config-drawer__source-item"
            data-drawer-source={provider.id}
            key={provider.id}
            {...(index === 0 ? { 'aria-current': 'true' as const } : {})}>
            <span className="config-drawer__source-badge" aria-hidden="true">{provider.name.slice(0, 1)}</span>
            <span className="config-drawer__source-name">{provider.name}</span>
            <span className="config-drawer__source-status">{provider.capabilities} 项能力 · 已启用 {provider.enabled}</span>
            {provider.marker === 'none' ? null : (
              <span className={`config-drawer__source-dot config-drawer__source-dot--${provider.marker}`} />
            )}
          </div>
        ))}
      </div>
      <div className="config-drawer__detail">
        <div className="config-drawer__detail-head">
          <strong>{selected.name}</strong>
          <span className="config-drawer__source-status">{selected.capabilities} 项能力</span>
        </div>
        <div className="config-drawer__detail-actions">
          {/* 静态阶段：画禁用态，不画「点了没反应」的按钮；可访问名照有。 */}
          <Button aria-label="官网（静态版暂不可用）" disabled size="small">官网</Button>
          <Button aria-label="测试连接（静态版暂不可用）" disabled size="small">测试连接</Button>
        </div>
        <div className="config-drawer__group-title">健康</div>
        <div className="config-drawer__row">
          <span className="config-drawer__label">今天有没有读数</span>
          <span className="config-drawer__value">—</span>
        </div>
        <div className="config-drawer__row">
          <span className="config-drawer__label">上次成功</span>
          <span className="config-drawer__value">—</span>
        </div>
        <div className="config-drawer__row">
          <span className="config-drawer__label">为什么没在采</span>
          <span className="config-drawer__value">未知</span>
        </div>
        <div className="config-drawer__row">
          <span className="config-drawer__label">能不能立刻采</span>
          <span className="config-drawer__value">—</span>
        </div>
        <div className="config-drawer__group-title">翻译偏好</div>
        <div className="config-drawer__row">
          <span className="config-drawer__label">自动翻译</span>
          <span className="config-drawer__value">未启用</span>
        </div>
        <div className="config-drawer__row">
          <span className="config-drawer__label">目标语言</span>
          <span className="config-drawer__value">简体中文</span>
        </div>
        <div className="config-drawer__row">
          <span className="config-drawer__label">翻译内容</span>
          <span className="config-drawer__value">标题 · 摘要 · 证据摘录</span>
        </div>
        <div className="config-drawer__detail-foot">
          <Button disabled size="small">在数据源中配置</Button>
        </div>
      </div>
    </div>
  )
}
