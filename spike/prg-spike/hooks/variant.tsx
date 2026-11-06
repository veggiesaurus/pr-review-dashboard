import type { ClientModule } from 'claude-code'

// One small tree per variant, to find which part of the hunk Client a surface refuses.
type Props = { variant: string }
type State = { started: true }

const DIFF = ['@@ -1,2 +1,2 @@', ' const a = 1', '-const b = 2', '+const b = 3'].join('\n')

const Variant: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text, Code } = surface.elements

  // A timer, not the first call: a tree the surface refuses unmounts the instance before it fires.
  if (surface.state === undefined) {
    surface.setState({ started: true })
    let stop = () => {}
    stop = surface.every(1000, () => {
      surface.post({ kind: 'drawn', variant: props.variant })
      stop()
    })
  }

  switch (props.variant) {
    case 'text':
      return <Text>plain text</Text>
    case 'code-line':
      return <Code source="const a = 1" />
    case 'code-language':
      return <Code language="typescript" source="const a = 1" />
    case 'code-diff':
      return <Code format="diff" source={DIFF} />
    case 'code-diff-truncate':
      return <Code format="diff" wrap="truncate-end" source={DIFF} />
    case 'code-in-box':
      return (
        <Box flexDirection="column">
          <Code source="const a = 1" />
        </Box>
      )
    default:
      return (
        <Box flexDirection="row">
          <Box flexDirection="column" width={2}>
            <Text> </Text>
          </Box>
          <Code format="diff" wrap="truncate-end" source={DIFF} />
        </Box>
      )
  }
}

export default Variant
