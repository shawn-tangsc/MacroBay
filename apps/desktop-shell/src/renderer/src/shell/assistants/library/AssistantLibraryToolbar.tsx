import { Button, Input, Tooltip } from 'antd'
import { Download, Search, Settings2, UserRoundPlus } from 'lucide-react'
import type { PlatformText } from '../../../i18n/platformText'

type AssistantLibraryToolbarProps = {
  labels: PlatformText['assistants']['library']
  title: string
  count: number
  search: string
  onSearchChange: (value: string) => void
  onImport: () => void
  onManage: () => void
  onCreate: () => void
}

export function AssistantLibraryToolbar({
  labels,
  title,
  count,
  search,
  onSearchChange,
  onImport,
  onManage,
  onCreate
}: AssistantLibraryToolbarProps): React.ReactElement {
  return (
    <div className="assistant-library-toolbar">
      <div className="assistant-library-heading">
        <strong>{title}</strong>
        <small>{count}</small>
      </div>
      <Input
        className="assistant-library-search"
        prefix={<Search size={14} />}
        value={search}
        placeholder={labels.searchPlaceholder}
        onChange={(event) => onSearchChange(event.target.value)}
        allowClear
      />
      <div className="assistant-library-actions">
        <Tooltip title={labels.importExternal}>
          <Button
            type="text"
            className="ant-shell-icon-button"
            icon={<Download size={15} />}
            aria-label={labels.importExternal}
            onClick={onImport}
          />
        </Tooltip>
        <Button type="text" icon={<Settings2 size={15} />} onClick={onManage}>
          {labels.manageAssistants}
        </Button>
        <Button type="primary" icon={<UserRoundPlus size={15} />} onClick={onCreate}>
          {labels.createAssistant}
        </Button>
      </div>
    </div>
  )
}
