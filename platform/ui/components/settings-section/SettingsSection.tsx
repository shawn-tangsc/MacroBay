import type { ReactNode } from 'react'

/**
 * 设置区块（标题 + 内容）：抽屉六屏共用，值照设置页现状抄，**不另立一套界面语言**。
 *
 * 值来源 = 设置页现状（`ui-rules` 的档位）：区块标题 **13 / 650**；标题与内容间距 **8**；
 * 区块之间 **16**；内容里的行按 44 高、标签列 160、右缘无发丝线以外不加装饰。设置页本轮不迁，
 * 将来把设置页换成这几个件时**以它为基准**，不许出现两套数。
 *
 * 行本身不在这里造：仓里已有 `@platform/ui/components/settings-row` 的 `SettingsRow`
 * （结构件、类名由调用方给），抽屉直接用那个，把 class 传成 `config-drawer__*`。
 * 所以这里只提供**区块**与**卡头**两件，避免同一概念出现两个 `SettingsRow`。
 */
export function SettingsSection({ title, children, action }: Readonly<{
  /** 区块名（读者可见文案，由调用方解析好再传）。 */
  title: string
  /** 标题右侧的动作槽（可选）：一颗按钮或一条跳转。 */
  action?: ReactNode
  children: ReactNode
}>): React.ReactElement {
  return <section className="settings-section" data-settings-section-block="true">
    <SettingsSectionHeader action={action} title={title} />
    <div className="settings-section__body">{children}</div>
  </section>
}

/**
 * 区块头：标题 **13 / 650**，ⓘ 紧跟标题（间距 4，不推到右侧），右侧动作槽与标题分列两端。
 *
 * 拆出来是为了两处能分别复用：有的屏只有标题（没有 ⓘ、没有动作），有的屏要在标题行放一颗按钮。
 */
export function SettingsSectionHeader({ title, info, action }: Readonly<{
  title: string
  /** ⓘ 槽：只放 `Popover` 的触发器，说明句进浮层，正文只留标题。 */
  info?: ReactNode
  /** 右侧动作槽。 */
  action?: ReactNode
}>): React.ReactElement {
  return <div className="settings-section__header">
    <h3 className="settings-section__title">
      {title}
      {info === undefined ? null : <span className="settings-section__info">{info}</span>}
    </h3>
    {action === undefined ? null : <span className="settings-section__action">{action}</span>}
  </div>
}
