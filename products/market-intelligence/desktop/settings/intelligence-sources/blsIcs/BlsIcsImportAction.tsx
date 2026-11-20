import { Button } from 'antd'
import { Upload } from 'lucide-react'
import type { ReactElement } from 'react'

import { macroEconomicCalendarClient } from '../../../shared/ipc/macroEconomicCalendarClient'
import { ImportBlsIcsDialog } from './ImportBlsIcsDialog'
import { useBlsIcsImport } from './useBlsIcsImport'

/**
 * 「导入 BLS ICS」动作：**只出现在设置 → 数据源 → 美国劳工统计局那张卡里**（用户 2026-11-15）。
 *
 * 日历工具栏上那个入口已经删掉——两处入口迟早两套状态（同一天已经在别处踩过）。
 * 导入逻辑与对话框本身是从日历 feature 挪过来的，不反向依赖它；样式也随组件一起搬，
 * 因为对话框挂在 `body` 上、必须自带 token。
 */
export function BlsIcsImportAction(props: { resolveText: (key: string) => string }): ReactElement {
  const importer = useBlsIcsImport({ client: macroEconomicCalendarClient })
  return <>
    <Button
      className="source-provider-detail__name-action"
      icon={<Upload aria-hidden="true" size={14} />}
      onClick={() => void importer.selectFile()}
      size="small">{props.resolveText('pages.intelligence.portal.calendar.manualImport.action')}</Button>
    <ImportBlsIcsDialog
      dialogState={importer.dialogState}
      onClose={importer.closeDialog}
      onConfirm={() => void importer.confirmImport()}
      resolveText={props.resolveText} />
  </>
}
