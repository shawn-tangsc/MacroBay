/**
 * 平铺水印：示例模式下任何面板截图的角落里都能看到它。
 *
 * 纯装饰层：不拦截点击、不参与布局、不读状态。文案由调用方给（走 i18n）。
 */
const columns = 6
const rows = 5

export function SampleWatermark({ text }: { text: string }): React.ReactElement {
  const cells = Array.from({ length: columns * rows }, (_, index) => index)
  return (
    <div aria-hidden="true" className="mi-sample-watermark">
      {cells.map((index) => (
        <span className="mi-sample-watermark__cell" key={index}>{text}</span>
      ))}
    </div>
  )
}
