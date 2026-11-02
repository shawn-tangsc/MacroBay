/* 负向夹具：状态判定决定整片内容画不画——**必须被报成候选**。 */
export function NegativeFixture(props: { state: string; rows: string[] }) {
  return (
    <section>
      {props.state === 'available' ? (
        <table>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row}><td>{row}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>nothing</p>
      )}
    </section>
  )
}
