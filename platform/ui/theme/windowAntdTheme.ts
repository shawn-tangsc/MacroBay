import { theme as antdTheme, type ThemeConfig } from 'antd'

import type { AccentColor } from '../../settings/schema/appSettings'
import { resolveWindowAntdTokenValues, type WindowThemeVariant } from './windowTheme'

/**
 * Owner: platform/ui/theme（**PLAT-42 ②：antd token 由颜色单源产出**）。
 *
 * 主窗（`AppShell.getAntdTheme()`）与分离窗（`DetachedWindowThemeShell`）**共用本函数**：
 * 两窗因此不可能出现「同一组件两套 token」（PLAT-39 ② 的原始缺陷：分离窗没有 `ConfigProvider`，
 * 同一个 `.ant-segmented` 在主窗是 12px/5px、在分离窗退化成 14px/4px）。
 *
 * 纪律：本文件**不出现任何颜色字面量/尺寸字面量**——所有值都来自 `./windowTheme`（唯一来源）。
 * 渲染侧专用（import antd 的算法）；主进程只 import `./windowTheme` 的纯数据，不会把 antd 拖进主进程包。
 */
export function buildWindowAntdTheme(variant: WindowThemeVariant, accentColor: AccentColor): ThemeConfig {
  const values = resolveWindowAntdTokenValues(variant, accentColor)
  return {
    algorithm: variant === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: values.colorPrimary,
      controlHeight: values.controlHeight,
      controlHeightSM: values.controlHeightSM,
      controlHeightLG: values.controlHeightLG,
      fontSize: values.fontSize,
      fontSizeSM: values.fontSizeSM,
      borderRadius: values.borderRadius,
      colorBgContainer: values.colorBgContainer,
      colorBgElevated: values.colorBgElevated,
      colorBorder: values.colorBorder,
      colorText: values.colorText,
      colorTextSecondary: values.colorTextSecondary,
      // accent 底上的文字色：与 `--accent-contrast` 同源，避免 antd 默认白色。
      colorTextLightSolid: values.colorTextLightSolid
    },
    components: {
      Button: {
        controlHeight: values.controlHeight,
        controlHeightSM: values.controlHeightSM,
        fontWeight: values.buttonFontWeight
      },
      Input: { controlHeight: values.controlHeight },
      Select: { controlHeight: values.controlHeight },
      Switch: {
        trackHeightSM: values.switchTrackHeightSM,
        trackMinWidthSM: values.switchTrackMinWidthSM
      },
      Segmented: {
        itemSelectedBg: values.segmented.itemSelectedBg,
        itemSelectedColor: values.segmented.itemSelectedColor
      }
    }
  }
}

/**
 * antd 的「两个汉字之间自动加空格」在全局关掉，只关这一次。
 *
 * 开着的话，「收起」会渲染成「收 起」，中文按钮里到处是这种空格。逐按钮写 `autoInsertSpace={false}`
 * 只能按到写过的那几个：换到基座的按钮会一个一个再冒出来，七条线就是七份覆盖，而且没人记得删。
 * 主窗与分离窗两个 `ConfigProvider` 都读这一份，产品侧一个都不许写。
 */
export const WINDOW_ANTD_BUTTON_CONFIG = Object.freeze({ autoInsertSpace: false })
