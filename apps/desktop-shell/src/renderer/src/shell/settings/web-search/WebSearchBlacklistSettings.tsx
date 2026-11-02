import { useState } from 'react'
import { X } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'

import type { PlatformText } from '../../../i18n/platformText'
import { WebSearchFormRow } from './WebSearchFormGrid'

/** 读屏名模板带着域名参数：句子在文案表里，这里只给可变的那段。 */
export const REMOVE_KEY = 'webSearch.removeTag'

type WebSearchBlacklistSettingsProps = {
  labels: PlatformText['webSearch']
  value: string[]
  onChange: (value: string[]) => void
}

/**
 * R6：域名黑名单用 tag 输入。既有条目是可删除 chip，回车添加；
 * 数据形状仍是 string[]（一行/通配子域名语义不变），提交给 IPC 的载荷没有变化。
 */
export function WebSearchBlacklistSettings({
  labels,
  value,
  onChange
}: WebSearchBlacklistSettingsProps): React.ReactElement {
  const [text, setText] = useState('')

  function addDomain(): void {
    const domain = text.trim()
    setText('')
    if (!domain || value.includes(domain)) return
    onChange([...value, domain])
  }

  return (
    <section className="web-search-settings-card">
      <div className="section-heading">
        <span>{labels.blacklist}</span>
      </div>
      <WebSearchFormRow label={labels.blacklistDomains} hint={labels.blacklistHint}>
        <div className="web-search-tags">
          {value.map((domain) => (
            <span key={domain} className="web-search-tag">
              <span>{domain}</span>
              <IconButton
                ariaLabelKey={REMOVE_KEY}
                ariaLabelParams={{ domain }}
                icon={X}
                onSelect={() => onChange(value.filter((item) => item !== domain))}
                resolveText={(key) => (key === REMOVE_KEY ? labels.removeTag(domain) : '')}
                size="sm"
              />
            </span>
          ))}
          <input
            className="web-search-tag-input"
            value={text}
            placeholder={labels.blacklistPlaceholder}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              addDomain()
            }}
          />
        </div>
      </WebSearchFormRow>
    </section>
  )
}
