import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 通知抽屉的行对齐：这屏里有两类行（原生开关行、阈值/国家那两行），它们必须用**同一套数字**，
 * 否则标签左缘差 12、控件左缘差 16，一眼就能看出来。这里按 CSS 原文钉住四个数：
 * 行内距 12、标签列 160、控件前距 8（于是控件左缘 12+160+12+8=192）、行高 44。
 * happy-dom 没有排版引擎，量不到像素——所以钉的是**声明**，改数字必须改这里。
 */
const drawerCss = readFileSync(join(__dirname, '../../settings/config-drawer/configDrawer.css'), 'utf8')
const screenCss = readFileSync(join(__dirname, 'intelligence-notification.css'), 'utf8')

function rule(css: string, selector: string, occurrence = 0): string {
  let at = -1
  for (let i = 0; i <= occurrence; i += 1) {
    at = css.indexOf(`${selector} {`, at + 1)
    expect(at, `缺少规则：${selector}`).toBeGreaterThan(-1)
  }
  const end = css.indexOf('\n}', at)
  return css.slice(at, end)
}

describe('the notification drawer rows share one set of alignment numbers', () => {
  it('keeps the drawer row at 44 high, 12 padding, 160 label, 8 before the control', () => {
    expect(rule(drawerCss, '.config-drawer__row')).toContain('min-height: 44px')
    expect(rule(drawerCss, '.config-drawer__row')).toContain('padding: 0 12px')
    expect(rule(drawerCss, '.config-drawer__label')).toContain('flex: 0 0 160px')
    expect(rule(drawerCss, '.config-drawer__value')).toContain('margin-left: 8px')
  })

  it('normalizes the threshold / countries rows to the same numbers inside this screen', () => {
    expect(rule(screenCss, '.intelligence-notification-drawer .intelligence-notification-form-row'))
      .toContain('min-height: 44px')
    expect(rule(screenCss, '.intelligence-notification-drawer .intelligence-notification-form-row'))
      .toContain('padding: 0 12px')
    expect(rule(screenCss, '.intelligence-notification-drawer .intelligence-notification-form-label'))
      .toContain('flex: 0 0 160px')
    expect(rule(screenCss, '.intelligence-notification-drawer .intelligence-notification-form-control'))
      .toContain('margin-left: 8px')
  })

  it('keeps a row note on one line inside the control column, centred with the controls', () => {
    // 同一条选择器前面还有一份归一化规则；这里要的是后加的「提示与控件同一行」那份。
    const control = rule(screenCss, '.intelligence-notification-drawer .intelligence-notification-form-control', 1)
    expect(control).toContain('display: flex')
    expect(control).toContain('align-items: center')
    expect(rule(screenCss, '.intelligence-notification-drawer .intelligence-notification-form-note'))
      .toContain('white-space: nowrap')
    expect(rule(screenCss, '.intelligence-notification-drawer .intelligence-notification-form-note'))
      .toContain('text-overflow: ellipsis')
  })

  it('puts the block title on the same left edge as the row labels', () => {
    expect(rule(screenCss, '.intelligence-notification-drawer .settings-section > .settings-section__header'))
      .toContain('padding-left: 12px')
  })
})
