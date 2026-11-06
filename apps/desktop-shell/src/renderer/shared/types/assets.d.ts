/**
 * 构建期资源的 `?url` 导入：返回打包后该资源的地址字符串。
 * Vite 自己会处理，但 TS 需要一句声明，否则 `import x from '@resources/icon.png?url'` 编不过。
 */
declare module '*?url' {
  const url: string
  export default url
}
