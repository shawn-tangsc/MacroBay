import { Button } from 'antd'
import { Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { useConfirm } from '@platform/ui/components/confirm'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import type { BriefingPeriod, BriefingPeriodDraft } from '../../../contracts/dailyBriefingPeriod'
import { dailyBriefingPeriodClient, type DailyBriefingPeriodClient } from '../../shared/ipc/dailyBriefingPeriodClient'
import { BriefingPeriodDialog } from './BriefingPeriodDialog'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * 设置面板里「期配置」这一块：一期一行，加一期一个入口。
 *
 * 三条从 `02` 落进结构：
 * - **0 条时这一块要自己说话**（`A10y`）：一句「还没有设置任何一期」+ 直接可点的「添加一期」，
 *   而且**绝不把读者指去设置页改生成时间**——那个入口本版已经拿掉了，指过去等于承认功能坏了；
 * - **入口永远可点**（`A1.1`）：它不再是那颗写着「这个版本还不支持一天多期」的灰按钮；
 * - **保存被拒时留在这里说**：冲突的那一行由弹框自己点名（它拿同一份期列表算唯一性），这一块
 *   只负责把「没存上」说出来，且不把读者已经填好的草稿丢掉。
 *
 * 读写只走 `dailyBriefingPeriodClient`：那是期配置自己的四个方法，碰不到旧的生成设置。
 */
export function BriefingPeriodsPanel({ text, client = dailyBriefingPeriodClient }: Readonly<{
  text: DailyBriefingText
  client?: Pick<DailyBriefingPeriodClient, 'list' | 'create' | 'update' | 'remove'>
}>): React.ReactElement {
  const [periods, setPeriods] = useState<readonly BriefingPeriod[] | null>(null)
  const [failed, setFailed] = useState(false)
  // 哪一期正在被编辑；`undefined` 就是"加一期"。同一张弹框，两种身份，靠这一个值区分。
  const [editing, setEditing] = useState<BriefingPeriod | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  // 删除失败要单独说：共用「没存上」会把"这次没删掉"读成"编辑没生效"，读者不知道还要不要重来。
  const [deleteFailed, setDeleteFailed] = useState(false)
  const confirm = useConfirm()
  // 服务端要求带上语言：它要决定"一条期都没有时那条默认期用哪种语言"，不猜。界面语言就是答案，
  // 不带参数会被拒（`daily-briefing-locale-required`）——这一处曾经把整块显示成"没读出来"。
  const locale = useShellLanguage()
  const copy = text.settings.periods
  const languageName = (locale: string): string => (text.settings.languageNames as Record<string, string>)[locale] ?? locale

  const load = (): void => {
    setFailed(false)
    void client.list(locale)
      .then((saved) => { setPeriods(saved) })
      .catch(() => { setFailed(true); setPeriods(null) })
  }
  useEffect(load, [client, locale])

  const save = (draft: BriefingPeriodDraft): void => {
    setSaving(true)
    setSaveFailed(false)
    setDeleteFailed(false)
    const target = editing
    // 写入同样带语言：服务端靠它决定新期在旧设置语言下的显示，同一个理由，不猜。
    const write = target === undefined ? client.create(draft, locale) : client.update(target.id, draft, locale)
    void write
      .then((result) => {
        if (result.state === 'saved') {
          setAdding(false)
          setEditing(undefined)
          // **保存后重读**：写入回执里的列表是服务端写的那一刻的快照，不是读者下一次看到的真相；
          // 重读一次（同一个 `list`），弹窗与期存储逐项一致。
          load()
          return
        }
        // The dialog already names the conflicting row from the same list, so a rejection here means
        // the store saw something the form did not. Say it in place and keep the draft.
        setSaveFailed(true)
      })
      .catch(() => { setSaveFailed(true) })
      .finally(() => { setSaving(false) })
  }

  if (periods === null) {
    return failed
      ? <div className="mi-briefing-periods" data-briefing-periods="true">
        <p className="mi-daily-briefing__settings-error" role="alert">{copy.loadFailed}</p>
        {/* 读不出来时这颗按钮重新**读**，所以它不能写「添加一期」——文字说的事就是它做的事。 */}
        <Button data-briefing-periods-retry-load="true" onClick={load}>{copy.retryLoad}</Button>
      </div>
      : <LoadingState label={copy.loading} minHeight={90} />
  }

  return <div className="mi-briefing-periods" data-briefing-periods="true">
    {periods.length === 0
      ? <div className="mi-briefing-periods__empty" data-briefing-periods-empty="true">
        <p>{copy.empty}</p>
        <p className="mi-briefing-periods__hint">{copy.emptyHint}</p>
      </div>
      : <ul className="mi-briefing-periods__list">
        {/* 一行就是一期，点它改这一期：期级动作只有"改"和"再加一期"，所以整行都是那个入口，
            不再套一层菜单——菜单要占一次点击，而这里只有一个动作。 */}
        {periods.map((period, index) => <li className="mi-briefing-periods__row" data-period-id={period.id} key={period.id}>
          {/* 行本身不可点：可点区域里再放两个按钮，读屏和键盘会抢焦点，容易把想编辑的人带到整行。
              编辑只从铅笔进，入口一个、位置固定。 */}
          <span className="mi-briefing-periods__text">
            <strong>{copy.label.replace('{index}', String(index + 1))}</strong>
            <span>{copy.timeValue.replace('{time}', period.generationTime)}</span>
            <span>{copy.windowValue.replace('{hours}', String(period.windowHours))}</span>
            <span>{languageName(period.language)}</span>
          </span>
          <IconButton
            ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.editRow"
            ariaLabelParams={{ index: String(index + 1) }}
            data-period-edit={period.id}
            icon={Pencil}
            resolveText={(key) => key === 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.editRow'
              ? copy.editRow.replace('{index}', String(index + 1))
              : key}
            size="sm"
            variant="plain"
            onSelect={() => { setEditing(period); setSaveFailed(false) }}
          />
          <IconButton
            ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.deleteRow"
            ariaLabelParams={{ index: String(index + 1) }}
            icon={Trash2}
            resolveText={(key) => key === 'pages.intelligence.portal.dashboard.dailyBriefing.settings.periods.deleteRow'
              ? copy.deleteRow.replace('{index}', String(index + 1))
              : key}
            size="sm"
            variant="plain"
            onSelect={() => {
              // 删的是排期，不是正文：明天起不再自动生成，已经生成的报还能看——与列表行上的
              // 「删除这一期」是同一个动作、同一个 `remove`。
              confirm({
                title: copy.deleteTitle.replace('{index}', String(index + 1)),
                description: copy.deleteBody,
                confirmLabel: copy.deleteConfirm,
                cancelLabel: text.periodDialog.cancel,
                tone: 'danger',
                onConfirm: () => {
                  // 界面语言必填：服务端每个方法都要它，漏传就是 `daily-briefing-locale-required`。
                  setDeleteFailed(false)
                  setSaveFailed(false)
                  void client.remove(period.id, locale)
                    .then(() => { load() })
                    .catch(() => setDeleteFailed(true))
                }
              })
            }}
          />
        </li>)}
      </ul>}
    <Button className="mi-briefing-periods__add" data-briefing-period-add="true" onClick={() => setAdding(true)} type={periods.length === 0 ? 'primary' : 'default'}>
      {copy.add}
    </Button>
    {saveFailed ? <p className="mi-daily-briefing__settings-error" role="alert">{copy.saveFailed}</p> : null}
    {deleteFailed ? <p className="mi-daily-briefing__settings-error" role="alert">{copy.removeFailed}</p> : null}
    <BriefingPeriodDialog
      // 加了 key 才换得住身份：弹框的草稿只在挂载时取一次，改一期时若不重挂，表单里还是上一次的值。
      key={editing?.id ?? 'new'}
      open={adding || editing !== undefined}
      text={text}
      periods={periods}
      {...(editing === undefined ? {} : { editing })}
      saving={saving}
      onSave={save}
      onClose={() => { if (!saving) { setAdding(false); setEditing(undefined); setSaveFailed(false); setDeleteFailed(false) } }}
    />
  </div>
}
