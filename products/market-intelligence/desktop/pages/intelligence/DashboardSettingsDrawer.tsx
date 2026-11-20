import type { ReactNode } from 'react'

import { ConfirmProvider, useConfirm } from '@platform/ui/components/confirm'
import { ErrorBoundary } from '@platform/ui/components/error-boundary'

import { ConfigSettingsDrawer } from '../../settings/config-drawer/ConfigSettingsDrawer'
import { NotificationSettingsPanel } from '../../settings/intelligence-notification/NotificationSettingsPanel'
import { AnalysisSettingsPanel } from './AnalysisSettingsPanel'
import { ConfigDrawerPanel } from './ConfigDrawerPanel'
import { DailyBriefingSettingsPanel, type BriefingSection } from './DailyBriefingSettingsPanel'
import { DashboardSourcesPanel } from './DashboardSourcesPanel'
import { ProcessingSettingsPanel, type ProcessingSection } from './ProcessingSettingsPanel'
import { RunLogDrawerPanel } from './RunLogDrawerPanel'

/**
 * 看板上的设置抽屉（2026-11-16 从主文件抽出来控体积，只搬不改）。
 *
 * 里面那个 `DrawerDiscardConfirm` 必须在平台 `ConfirmProvider` 之内取 `useConfirm`，
 * 所以它和抽屉一起搬：宿主只传状态与回调，不传 provider。
 */
export function DashboardSettingsDrawer({ open, requestKey, initialMenu, initialDrawerSection, initialSourceFilter,
  initialBusinessPosition, onOpenProcessingSettings, sourcesDraftDirty, screen, onScreenState, onClose, onDraftChange }: Readonly<{
  open: boolean
  requestKey: number
  initialMenu: Parameters<typeof ConfigSettingsDrawer>[0]['initialMenu']
  /** 打开时落到哪一屏的哪一节（页面层请求）。 */
  initialDrawerSection?: Readonly<{ menu: string; section: string }>
  /** 打开时源列表的筛选档（源屏自己也有默认值，这里只作初值）。 */
  initialSourceFilter?: Parameters<typeof DashboardSourcesPanel>[0] extends infer T
    ? T extends { initialFilter?: infer F } ? F : never : never
  initialBusinessPosition?: Parameters<typeof DashboardSourcesPanel>[0] extends infer T
    ? T extends { initialBusinessPosition?: infer P } ? P : undefined : undefined
  onOpenProcessingSettings?: () => void
  sourcesDraftDirty: boolean
  /** 当前屏的保存栏状态（脏/保存中/失败），由宿主那一个 `useState` 持有。 */
  screen: Readonly<{ dirty: boolean; saving: boolean; failure?: string; save: () => void }>
  onScreenState: (state: Readonly<{ dirty: boolean; saving: boolean; save: () => void; failure?: string }>) => void
  onClose: () => void
  onDraftChange: (dirty: boolean) => void
}>): React.ReactElement {
  return <ErrorBoundary scope="drawer"><ConfirmProvider><DrawerDiscardConfirm>
    {(confirmDiscard) => <ConfigSettingsDrawer
      confirmDiscard={confirmDiscard}
      key={`settings-drawer-${requestKey}`}
      initialMenu={initialMenu}
      isScreenDirty={() => screen.dirty || sourcesDraftDirty}
      onClose={onClose}
      open={open}
      analysisPanel={<ConfigDrawerPanel screen="analysis"><AnalysisSettingsPanel onState={onScreenState} /></ConfigDrawerPanel>}
      screenDirty={screen.dirty}
      onScreenSave={screen.save}
      screenSaving={screen.saving}
      {...(screen.failure === undefined ? {} : { screenSaveFailure: screen.failure })}
      briefingPanel={<ConfigDrawerPanel screen="briefing"><DailyBriefingSettingsPanel
        {...(initialDrawerSection?.menu === 'briefing' ? { initialSection: initialDrawerSection.section as BriefingSection } : {})}
        onState={onScreenState} /></ConfigDrawerPanel>}
      processingPanel={<ConfigDrawerPanel screen="processing"><ProcessingSettingsPanel
        {...(initialDrawerSection?.menu === 'processing' ? { initialSection: initialDrawerSection.section as ProcessingSection } : {})} /></ConfigDrawerPanel>}
      runLogPanel={<ConfigDrawerPanel screen="run-log"><RunLogDrawerPanel /></ConfigDrawerPanel>}
      notificationsPanel={<ConfigDrawerPanel screen="notifications"><NotificationSettingsPanel
        {...(initialDrawerSection?.menu === 'notifications' ? { initialSection: initialDrawerSection.section as never } : {})} /></ConfigDrawerPanel>}
      sourcesPanel={(nav) => <ConfigDrawerPanel screen="sources"><DashboardSourcesPanel
        pane="sources"
        {...(nav.focusSourceId === undefined ? {} : { initialSourceId: nav.focusSourceId })}
        initialFilter={initialSourceFilter}
        onDraftChange={onDraftChange} /></ConfigDrawerPanel>}
      sourcesDataPanel={(nav) => <ConfigDrawerPanel screen="sourcesData"><DashboardSourcesPanel
        pane="business"
        {...(initialBusinessPosition === undefined ? {} : { initialBusinessPosition })}
        onOpenSourceConfig={nav.openSource}
        {...(onOpenProcessingSettings === undefined ? {} : { onOpenProcessingSettings })}
        onDraftChange={onDraftChange} /></ConfigDrawerPanel>} />
    }</DrawerDiscardConfirm></ConfirmProvider></ErrorBoundary>
}

/**
 * 把平台 `useConfirm` 变成抽屉要的 `confirmDiscard`：必须在 provider 之内取，所以单独一层。
 * 弹窗本身由平台 `Confirm` 负责，这里只转交文案与动作。
 */
function DrawerDiscardConfirm({ children }: Readonly<{
  children: (confirmDiscard: NonNullable<React.ComponentProps<typeof ConfigSettingsDrawer>['confirmDiscard']>) => ReactNode
}>): React.ReactElement {
  const confirm = useConfirm()
  return <>{children((input) => confirm({
    title: input.title,
    description: input.body,
    confirmLabel: input.confirmLabel,
    cancelLabel: input.cancelLabel,
    tone: 'danger',
    onConfirm: input.onDiscard
  }))}</>
}
