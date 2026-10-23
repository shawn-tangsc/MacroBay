import { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import { ChevronDown, Code2 } from 'lucide-react'

import type { ExternalAppView } from '@platform/desktop/main/externalApps/externalAppRegistry'

import { useAgentText } from '../../agentTextProvider'

type OpenExternalAppButtonProps = {
  workspacePath: string | null | undefined
}

export default function OpenExternalAppButton({
  workspacePath
}: OpenExternalAppButtonProps): React.ReactElement | null {
  const t = useAgentText()
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
      <Tooltip title={t.chatNavbar.openInExternalApp(selectedApp.name)}>
        <Button
          className="ant-shell-icon-button"
          type="text"
          size="small"
          icon={<Code2 size={15} />}
          aria-label={t.chatNavbar.openInExternalApp(selectedApp.name)}
          onClick={() => void launch(selectedApp.id)}
        />
      </Tooltip>
      {apps.length > 1 ? (
        <Tooltip title={t.chatNavbar.openInExternalAppMenu}>
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
