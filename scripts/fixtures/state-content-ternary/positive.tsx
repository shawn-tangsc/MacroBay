/* 正向夹具：两支都是空态/加载组件，没有内容容器——**不许报**。 */
export function PositiveFixture(props: { state: string }) {
  return (
    <section>
      {props.state === 'error' ? (
        <StateView state="error" reasonCode="unreadable" />
      ) : (
        <LoadingState label="loading" />
      )}
    </section>
  )
}
