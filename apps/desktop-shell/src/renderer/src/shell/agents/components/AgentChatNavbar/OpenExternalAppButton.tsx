import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown } from 'antd'
import type { MenuProps } from 'antd'
import { ChevronDown, Code2 } from 'lucide-react'

import type { ExternalAppView } from '@platform/desktop/main/externalApps/externalAppRegistry'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
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
  // 两颗都是键：带应用名的那颗用 `{name}` 模板 + `labelParams`，句子在文案表里，值在这里填。
  const tooltipKeys = {
    openInExternalApp: 'chatNavbar.openInExternalApp',
    openInExternalAppMenu: 'chatNavbar.openInExternalAppMenu'
  } as const satisfies Record<string, AgentTooltipKey>
  const resolveText = (key: AgentTooltipKey): string => resolveAgentTooltipText(t, key)
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
      <Tooltip
        labelKey={tooltipKeys.openInExternalApp}
        labelParams={{ name: selectedApp.name }}
        resolveText={resolveText}>
        <Button
          className="ant-shell-icon-button"
          type="text"
          size="small"
          icon={<Code2 size={15} />}
          aria-label={fillLabelParams(t.chatNavbar.openInExternalApp, { name: selectedApp.name })}
          onClick={() => void launch(selectedApp.id)}
        />
      </Tooltip>
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
