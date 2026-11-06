import type { ClientModule } from 'claude-code'

// Row 0 is the @@ header and row n is line n, in both modes. The gutter marks the row the
// module thinks was clicked, so a misaligned Code draw shows as a mark beside the wrong line.
type Props = { mode: 'code' | 'text'; path: string; header: string; lines: [string, string][] }
type State = { picked: number | null }

const Hunk: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text, Code } = surface.elements
  const picked = surface.state?.picked ?? null

  const pick = (row: number, via: 'pointer' | 'key', x: number) => {
    const line = row >= 1 && row <= props.lines.length ? row : null
    const text = line === null ? (row === 0 ? props.header : null) : (props.lines[line - 1]?.[1] ?? null)
    surface.setState({ picked: row })
    surface.post({
      kind: 'click',
      via,
      x,
      y: row,
      line,
      text,
      mode: props.mode,
      columns: surface.columns,
      rows: surface.rows,
    })
  }

  // Say once that this instance drew, so the hooks module can tell a variant that works from one that never reported.
  // A timer, not the first call: a tree the page refuses unmounts the instance before it fires.
  if (surface.state === undefined) {
    surface.setState({ picked: null })
    let stop = () => {}
    stop = surface.every(1000, () => {
      surface.post({ kind: 'drawn', lines: props.lines.length, mode: props.mode })
      stop()
    })
  }

  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') pick(event.y, 'pointer', event.x)
  })
  surface.onKey(event => {
    const at = picked ?? 0
    if (event.key === 'down') pick(Math.min(at + 1, props.lines.length), 'key', 0)
    if (event.key === 'up') pick(Math.max(at - 1, 0), 'key', 0)
  })

  const rows = props.lines.length + 1
  const gutter: string[] = []
  for (let row = 0; row < rows; row++) gutter.push(row === picked ? '›' : ' ')

  const source = [props.header, ...props.lines.map(([op, text]) => op + text)].join('\n')
  const colour = (op: string) => (op === '+' ? 'diffAdded' : op === '-' ? 'diffRemoved' : undefined)

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width={2}>
        {gutter.map(mark => (
          <Text color="warning">{mark}</Text>
        ))}
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        {props.mode === 'code' ? (
          <Code format="diff" wrap="truncate-end" path={props.path} source={source} />
        ) : (
          [
            <Text wrap="truncate-end" dimColor>
              {props.header}
            </Text>,
            ...props.lines.map(([op, text]) => (
              <Text wrap="truncate-end" color={colour(op)}>
                {op}
                {text}
              </Text>
            )),
          ]
        )}
      </Box>
    </Box>
  )
}

export default Hunk
