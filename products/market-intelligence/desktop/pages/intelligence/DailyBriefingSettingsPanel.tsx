import { Button } from 'antd'

import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { dailyBriefingClient } from '../../shared/ipc/dailyBriefingClient'
import { productText } from '../../shared/i18n/productText'
import { openModelSettings, openWebSearchSettings } from '../../shared/navigation/productShellNavigation'
import { DailyBriefingSettingsBlocks, useDailyBriefingSettingsBlocks } from './DailyBriefingSettingsBlocks'

/**
 * 配置抽屉「日报与简报」那一屏：**简报设置抽屉里那两块内容，原样搬进来**。
 *
 * 用户 2026-11-10：「现成的东西，挪进去不就行了吗」。所以这里不画任何新东西——生成块与
 * AI 块用的是同一份组件（`DailyBriefingSettingsBlocks`），读写也是同一个 hook。
 *
 * 与简报页那个抽屉只差外壳：页面上是抽屉自己的页脚承担「取消 / 保存」，配置抽屉里没有抽屉页脚，
 * 所以这里把同一颗「保存」放在内容末尾；**没有「取消」**——这一屏不会被关掉，草稿跟着这一屏走。
 *
 * 这里也不画标题：标题归配置抽屉（不做嵌套标题）。
 */
export function DailyBriefingSettingsPanel(): React.ReactElement {
  const language = useShellLanguage()
  const text = productText[language].pages.intelligence.portal.dashboard.dailyBriefing
  const blocks = useDailyBriefingSettingsBlocks({ client: dailyBriefingClient, open: true })

  return <div className="mi-briefing-settings-panel" data-briefing-settings-panel="true">
    <DailyBriefingSettingsBlocks
      ai={blocks.ai}
      onConfigureWebSearch={openWebSearchSettings}
      onOpenModelSettings={openModelSettings}
      text={text}
    />
    <div className="mi-briefing-settings__footer">
      {blocks.failedSentence ? <p className="mi-briefing-settings__footer-failed" data-settings-save-failed="true" role="alert">{blocks.failedSentence}</p> : null}
      <div className="mi-briefing-settings__footer-actions">
        {/* 保存成功之后草稿就不再是「未保存」，所以这里没有可关闭的外壳也就不需要回调。 */}
        <Button data-settings-save="true" disabled={!blocks.canSave} loading={blocks.saving} onClick={() => void blocks.saveAll(() => undefined)} type="primary">
          {blocks.saving ? text.generationSettings.saving : text.generationSettings.save}
        </Button>
      </div>
    </div>
  </div>
}
