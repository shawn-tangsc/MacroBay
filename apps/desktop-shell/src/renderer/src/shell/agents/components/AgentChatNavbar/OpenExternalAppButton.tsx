import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Tooltip as AntTooltip } from 'antd'
import type { MenuProps } from 'antd'
import { ChevronDown, Code2 } from 'lucide-react'

import type { ExternalAppView } from '@platform/desktop/main/externalApps/externalAppRegistry'
import { Tooltip } from '@platform/ui/components/tooltip'

import { useAgentText } from '../../agentTextProvider'
import { resolveAgentTooltipText, type AgentTooltipKey } from '../../agentTooltipText'

type OpenExternalAppButtonProps = {
  workspacePath: string | null | undefined
}

export default function OpenExternalAppButton({
  workspacePath
}: OpenExternalAppButtonProps): React.ReactElement | null {
  const t = useAgentText()
  // 只有「选择外部应用」这颗是纯键；上面那颗的文案带应用名（`openInExternalApp(name)`），
  // 平台的 Tooltip 目前不收参数，先留在 antd，等契约补 params。
  const tooltipKeys = { openInExternalAppMenu: 'chatNavbar.openInExternalAppMenu' } as const satisfies Record<string, AgentTooltipKey>
  const resolveText = (key: string): string => resolveAgentTooltipText(t, key)
  const [apps, setApps] = useState<ExternalAppView[]>([])
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.platform.app
      .listExternalApps()
      .then((next) => {
        if (cancelled) return
        setApps((next as ExternalAppView[]).filter((app) => app.installed))
      })
      .catch(() => {
        if (!cancelled) setApps([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectedApp = useMemo(
    () => apps.find((app) => app.id === selectedAppId) ?? apps[0] ?? null,
    [apps, selectedAppId]
  )

  if (!workspacePath || !selectedApp) return null

  async function launch(appId: string): Promise<void> {
    if (!workspacePath) return
    await window.platform.app.launchExternalAppWorkspace({
      appId,
      workspacePath
    })
  }

  const menuItems: MenuProps['items'] = apps.map((app) => ({
    key: app.id,
    label: app.name,
    onClick: () => {
      setSelectedAppId(app.id)
      void launch(app.id)
    }
  }))

  return (
    <span className="agent-external-app-actions">
      <AntTooltip title={t.chatNavbar.openInExternalApp(selectedApp.name)}>
        <Button
          className="ant-shell-icon-button"
          type="text"
          size="small"
          icon={<Code2 size={15} />}
          aria-label={t.chatNavbar.openInExternalApp(selectedApp.name)}
          onClick={() => void launch(selectedApp.id)}
        />
      </AntTooltip>
      {apps.length > 1 ? (
        <Tooltip labelKey={tooltipKeys.openInExternalAppMenu} resolveText={resolveText}>
          <Dropdown menu={{ items: menuItems }} trigger={['click']}>
            <Button
              className="ant-shell-icon-button"
              type="text"
              size="small"
              icon={<ChevronDown size={13} />}
              aria-label={t.chatNavbar.openInExternalAppMenu}
            />
          </Dropdown>
        </Tooltip>
      ) : null}
    </span>
  )
}
