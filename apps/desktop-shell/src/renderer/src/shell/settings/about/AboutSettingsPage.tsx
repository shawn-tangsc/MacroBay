import { useEffect, useState } from 'react'
import appIconUrl from '@resources/icon.png?url'
import { Button } from 'antd'

import type { AppSettings, AppSettingsPatch } from '@platform/settings/schema/appSettings'

import { platformText } from '../../../i18n/platformText'
import type { StructuredTextNode } from '@platform/contracts/structuredText'
import type { UpdateLinkId } from '@platform/updates/updateSource'
import { StructuredText } from '@platform/ui/components/structured-text'

import { VersionCheckRow } from '../version/VersionCheckRow'
import { platformUpdateCheckClient, type UpdateCheckClient } from '../version/updateCheckClient'

/**
 * 设置 → 关于我们。
 *
 * 只做三件事：**说清我装的是哪一版、有没有新版、去哪拿**。没有大图、没有营销语，
 * 与设置区其它页同一种密度（内容列 720，正文列 480）。
 *
 * 更新块**直接复用** `VersionCheckRow`（七态、文案、失败句都在里面，已签过）——
 * 同一组件换容器，不写第二套。链接块与更新说明分别在后续两步接上。
 */
export function AboutSettingsPage(props: {
  settings: AppSettings
  onUpdateSettings: (patch: AppSettingsPatch) => Promise<void>
  /** 产品名由宿主传入（`app.getName()`），它是个专有名词，不进词表。 */
  productName: string
  client?: UpdateCheckClient
}): React.ReactElement {
  const text = platformText[props.settings.language].about
  const client = props.client ?? platformUpdateCheckClient
  const [openFailed, setOpenFailed] = useState<UpdateLinkId | null>(null)
  const [markFailed, setMarkFailed] = useState(false)
  const [hasNewer, setHasNewer] = useState(false)
  const [notes, setNotes] = useState<readonly StructuredTextNode[] | null>(null)
  const [notesTruncated, setNotesTruncated] = useState(false)
  const [notesAtEnd, setNotesAtEnd] = useState(false)

  // 只有「有新版本」才显示说明块：它的正文属于最新那版，未必是读者正在跑的那一版。
  useEffect(() => {
    let alive = true
    const apply = (projection: { state: string }): void => {
      if (!alive) return
      const newer = projection.state === 'available'
      setHasNewer(newer)
      if (!newer) {
        setNotes(null)
        return
      }
      void client
        .getReleaseNotes()
        .then((result) => {
          if (!alive) return
          setNotes(result.ok && result.nodes ? result.nodes : null)
          setNotesTruncated(result.ok && result.truncated === true)
        })
        .catch(() => {
          if (alive) setNotes(null)
        })
    }
    void client.getState().then(apply).catch(() => undefined)
    const unsubscribe = client.onChanged((projection) => apply(projection))
    return () => {
      alive = false
      unsubscribe()
    }
  }, [client])

  // 「打开下载页」由更新块渲染；链接块固定四颗，download 不在这里重复（两颗按钮开同一地址就是缺陷）。
  const linkRows: { id: UpdateLinkId; label: string; action: string }[] = [
    { id: 'changelog', label: text.links.changelog, action: text.links.actionView },
    { id: 'docs', label: text.links.docs, action: text.links.actionView },
    { id: 'site', label: text.links.site, action: text.links.actionView },
    { id: 'feedback', label: text.links.feedback, action: text.links.actionFeedback }
  ]

  async function openLink(id: UpdateLinkId): Promise<void> {
    try {
      const result = await client.openUpdateLink(id)
      setOpenFailed(result.ok ? null : id)
    } catch {
      setOpenFailed(id)
    }
  }

  return (
    <section className="settings-detail-pane about-page">
      <header className="about-identity">
        {/* 图标是装饰：图片 aria-hidden，失败时用同尺寸占位（不写「加载失败」——那对读者没有动作价值）。 */}
        <span className="about-mark" aria-hidden="true">
          {markFailed ? <span className="about-mark-fallback" /> : (
            <img className="about-mark-image" src={appIconUrl} alt="" onError={() => setMarkFailed(true)} />
          )}
        </span>
        <div className="about-identity-text">
          <h2 className="about-name">{props.productName}</h2>
          <p className="about-tagline">{text.tagline}</p>
        </div>
      </header>

      {/* 标题跟组件走：VersionCheckRow 自带「版本」那一层，页面不再叠第二个标题。 */}
      <div className="preference-section">
        <VersionCheckRow settings={props.settings} onUpdateSettings={props.onUpdateSettings} client={client} />
      </div>

      {hasNewer && notes !== null ? (
        <div className="preference-section about-notes">
          <h3 className="about-section-title">{text.notes.title}</h3>
          {/* 固定高度 + 块内滚动（界面设计 11-03 定，推翻了先前「展开/靠页面滚」那版）。
              三条硬要求：③ 可聚焦（tabindex + role=region + 可读名），否则键盘用户滚不动；
              ④ `overscroll-behavior-y: auto`：块内到底后继续滚要带动外层页面；
              渐隐遮罩 `pointer-events: none`，且只在「还能往下滚」时出现。
              遮罩与滚动区同住一层 viewport：遮罩要贴**滚动区**底部，不是区块底部——
              否则下面常驻的截断行会把遮罩顶开，看起来像盖住了那行字。 */}
          <div className="about-notes-viewport">
            <div
              className="about-notes-scroller"
              data-about-notes-scroller
              tabIndex={0}
              role="region"
              aria-label={text.notes.title}
              onScroll={(event) => {
                const el = event.currentTarget
                setNotesAtEnd(el.scrollTop + el.clientHeight >= el.scrollHeight - 1)
              }}>
              <StructuredText nodes={notes} />
            </div>
            {notesAtEnd ? null : <div className="about-notes-fade" aria-hidden="true" />}
          </div>
          {/* 「有这行」和「有那块」是两件事：只有内容被截断才出这一行。 */}
          {notesTruncated ? <p className="preference-hint about-notes-truncated">{text.notes.truncated}</p> : null}
        </div>
      ) : null}

      <div className="preference-section">
        <h3 className="about-section-title">{text.links.title}</h3>
        <ul className="about-links">
          {linkRows.map((row) => (
            <li key={row.id} className="about-link-row">
              <span className="about-link-label">{row.label}</span>
              <Button className="ant-secondary-button" size="small" onClick={() => void openLink(row.id)}>
                {row.action}
              </Button>
            </li>
          ))}
        </ul>
        <p className="preference-hint">{text.links.hint}</p>
        {openFailed === null ? null : (
          <p className="preference-hint about-link-failed" role="status">
            {text.links.openFailed}
          </p>
        )}
      </div>
    </section>
  )
}
