/**
 * Application identity in one place.
 *
 * `APP_INTERNAL_NAME` is the Electron application name and therefore the `userData`
 * directory name. Keep it ASCII and stable; changing it moves every local database.
 * `APP_DISPLAY_NAME` is what people see in window titles, the tray, and packaging.
 * `APP_BUNDLE_ID` must match `appId` in electron-builder.yml; Windows uses it at
 * runtime for notifications and taskbar grouping.
 */
export const APP_INTERNAL_NAME = 'MacroBay'
export const APP_DISPLAY_NAME = 'MacroBay 观潮'
export const APP_ACCEPTANCE_NAME = 'MacroBay Acceptance'
export const APP_BUNDLE_ID = 'com.macrobay.desktop'
