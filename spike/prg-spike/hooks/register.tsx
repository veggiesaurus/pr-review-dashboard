import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { CardMode, Click, GhProbe, Layout, LinearProbe, McpRun, ProcRun, Resume, VariantResult, View } from '../types'
import { headerFor, madeUpHunk, sectionFiles, unified } from './data'
import type { Build, Guide } from './data'
import { ANSWER, WORKER_PROMPT, registerRuns, runLine, startRun } from './runs'

type Engine = EngineInterface

const PANE = 'prg-spike'
// Bumped on every edit, so the pane shows which copy of the mod is running.
const BUILD = 'b10'

const view = atom({ plugin: 'prg-spike', key: 'view' } as const, 'section')
const section = atom({ plugin: 'prg-spike', key: 'section' } as const, 0)
const mode = atom({ plugin: 'prg-spike', key: 'mode' } as const, 'code')
const size = atom({ plugin: 'prg-spike', key: 'size' } as const, 200)
const layout = atom({ plugin: 'prg-spike', key: 'layout' } as const, null, { shape: 'layout-1' })
const click = atom({ plugin: 'prg-spike', key: 'click' } as const, null, { shape: 'click-2' })
const drawn = atom({ plugin: 'prg-spike', key: 'drawn' } as const, [], { shape: 'drawn-2' })
const faults = atom({ plugin: 'prg-spike', key: 'faults' } as const, [], { shape: 'faults-3' })
const gh = atom({ plugin: 'prg-spike', key: 'gh' } as const, null, { shape: 'gh-1' })
const linear = atom({ plugin: 'prg-spike', key: 'linear' } as const, null, { shape: 'linear-1' })
const sent = atom({ plugin: 'prg-spike', key: 'sent' } as const, null, { shape: 'sent-1' })

// Declared again here, as in runs.ts: a file reads state only through atoms of its own.
const runs = atom({ plugin: 'prg-spike', key: 'runs' } as const, [], { shape: 'runs-1' })
const offers = atom({ plugin: 'prg-spike', key: 'offers' } as const, 0)
const variants = atom({ plugin: 'prg-spike', key: 'variants' } as const, [], { shape: 'variants-1' })
const variantAt = atom({ plugin: 'prg-spike', key: 'variantAt' } as const, -1)
const tagRows = atom({ plugin: 'prg-spike', key: 'tagRows' } as const, false)
const cardMode = atom({ plugin: 'prg-spike', key: 'cardMode' } as const, 'matcher')

// The Client variants, smallest first, that find which part of the hunk Client a surface refuses.
const VARIANT_NAMES = ['text', 'code-line', 'code-language', 'code-diff', 'code-diff-truncate', 'code-in-box', 'code-beside-gutter']
const VARIANT_WAIT_MS = 6000

const HUNK = madeUpHunk()
const VARIANTS = [
  { mode: 'code', size: 200 },
  { mode: 'code', size: 20 },
  { mode: 'code', size: 5 },
  { mode: 'text', size: 200 },
  { mode: 'text', size: 20 },
  { mode: 'text', size: 5 },
] as const

export const NOTES = [
  'prg-spike: 2 review notes on the fixture build at 7176310, each starting with its id and location.',
  'This is a spike test of how the notes card draws: change no files, and reply with one line naming the two note ids.',
  '',
  'n1 src/posts.ts:R4@7176310',
  'the /blog prefix should come from config',
  '',
  'n2 tests/posts.test.ts:R3@7176310',
  'why is this test skipped?',
].join('\n')

const clip = (text: string, most = 600) => (text.length > most ? `${text.slice(0, most)}…` : text)
const scrub = (text: string | undefined) =>
  text
    ?.split('\n')
    .filter(line => !/token/i.test(line))
    .join('\n')

async function run($: Engine, argv: string[], init?: { cwd?: string; timeoutMs?: number }): Promise<ProcRun> {
  const started = await $.clock.now()
  try {
    const ran = await $.process.run(argv, { stdin: '', ...init })
    return { argv, ms: (await $.clock.now()) - started, exitCode: ran.exitCode, stdout: ran.stdout, stderr: ran.stderr }
  } catch (error) {
    return { argv, ms: (await $.clock.now()) - started, error: clip(String(error), 300) }
  }
}

async function mcp($: Engine, server: string, tool: string, args: Record<string, unknown>): Promise<McpRun> {
  const started = await $.clock.now()
  try {
    const got = await $.mcp.call(server, tool, args)
    const text = got.content.flatMap(block => (block.type === 'text' && block.text ? [block.text] : [])).join('\n')
    return { tool, args, ms: (await $.clock.now()) - started, isError: got.isError, text: clip(text, 300) }
  } catch (error) {
    return { tool, args, ms: (await $.clock.now()) - started, error: clip(String(error), 300) }
  }
}

async function surfaceName($: Engine): Promise<string> {
  const all = await $.session.surfaces()
  return all.length > 0 ? all.join('+') : 'none'
}

// Results go to <repo>/.git/prg-spike/<session id>.json, so a desktop run can be read back from the terminal.
async function writeReport($: Engine): Promise<void> {
  try {
    const repo = await $.session.repo()
    const folder = repo ? `${repo.root}/.git/prg-spike` : `${(await $.env.get('TMPDIR')) ?? '/tmp'}/prg-spike`
    await $.process.run(['mkdir', '-p', folder])
    const report = {
      build: BUILD,
      root: $.plugin.root,
      version: await $.session.version(),
      surfaces: await $.session.surfaces(),
      cwd: await $.session.cwd(),
      layout: await read($, layout),
      click: await read($, click),
      faults: await read($, faults),
      drawn: await read($, drawn),
      gh: await read($, gh),
      linear: await read($, linear),
      sent: await read($, sent),
      runs: await read($, runs),
      variants: await read($, variants),
      offers: await read($, offers),
    }
    await $.fs.write(`${folder}/${await $.session.id()}.json`, JSON.stringify(report, null, 2))
  } catch (error) {
    $.ui.log(`prg-spike: report not written: ${String(error)}`, { to: 'debug' })
  }
}

async function probeGh($: Engine, surface: string): Promise<GhProbe> {
  const cwd = (await $.session.repo())?.root ?? (await $.session.cwd())
  const path = (await $.env.get('PATH')) ?? null
  const user = await run($, ['id', '-un'])
  const found: ProcRun[] = []
  let ghPath: string | null = null
  for (const candidate of ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']) {
    const tried = await run($, [candidate, '--version'])
    found.push({ ...tried, stdout: tried.stdout?.split('\n')[0] })
    if (tried.exitCode === 0) {
      ghPath = candidate
      break
    }
  }
  if (ghPath === null) {
    return { surface, cwd, path, user, found, gh: null, auth: null, checks: null, checkCount: null, buckets: null }
  }
  const auth = await run($, [ghPath, 'auth', 'status'], { cwd })
  const checks = await run($, [ghPath, 'pr', 'checks', '2', '--json', 'name,state,bucket,link'], { cwd, timeoutMs: 60_000 })
  let checkCount: number | null = null
  let buckets: Record<string, number> | null = null
  try {
    const rows = JSON.parse(checks.stdout ?? '') as { bucket?: string }[]
    checkCount = rows.length
    buckets = {}
    for (const row of rows) buckets[row.bucket ?? '?'] = (buckets[row.bucket ?? '?'] ?? 0) + 1
  } catch {
    // Not JSON: the exit code and stderr say why.
  }
  return {
    surface,
    cwd,
    path,
    user,
    found,
    gh: ghPath,
    auth: { ...auth, stdout: scrub(auth.stdout), stderr: scrub(auth.stderr) },
    checks: { ...checks, stdout: clip(checks.stdout ?? '', 300) },
    checkCount,
    buckets,
  }
}

// No get_issue tool means no Linear: nothing is called, shown or logged about it.
export async function findLinear($: Engine): Promise<{ server: string | null; toolCount: number }> {
  const tools = await $.tool.list()
  const hit = tools.map(tool => /^mcp__(.+)__get_issue$/.exec(tool.name)).find(match => match !== null)
  return { server: hit?.[1] ?? null, toolCount: tools.length }
}

async function probeLinear($: Engine, surface: string): Promise<LinearProbe> {
  const { server, toolCount } = await findLinear($)
  const calls: McpRun[] = []
  if (server !== null) {
    const listed = await mcp($, server, 'list_issues', { assignee: 'me', limit: 1 })
    calls.push(listed)
    const key = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/.exec(listed.text ?? '')?.[0]
    if (key !== undefined) calls.push(await mcp($, server, 'get_issue', { id: key }))
    calls.push(await mcp($, server, 'get_issue', { id: 'ZZZ-99999' }))
  }
  return { surface, toolCount, server, calls }
}

async function probe($: Engine): Promise<void> {
  const surface = await surfaceName($)
  const [ghFound, linearFound] = await Promise.all([probeGh($, surface), probeLinear($, surface)])
  await update($, gh, () => ghFound)
  await update($, linear, () => linearFound)
  await writeReport($)
}

async function sendNotes($: Engine): Promise<void> {
  const surface = await surfaceName($)
  const result = await $.prompt.submit({ text: NOTES })
  const summary = 'drop' in result && result.drop !== undefined ? `dropped: ${result.drop}` : 'entered; its turn started'
  await update($, sent, () => ({ result: summary, surface }))
  await writeReport($)
}

function parseResume(value: unknown): Resume {
  return value === 'stopped-allow' || value === 'stopped-refuse' ? value : 'live'
}

// Records how a variant went on a surface and moves the runner on to the next one.
async function settle($: Engine, surface: string, variant: string, result: VariantResult['result'], reason?: string) {
  const at = await read($, variantAt)
  if (VARIANT_NAMES[at] !== variant) return
  await update($, variants, list => [...list, { surface, variant, result, ...(reason === undefined ? {} : { reason }) }])
  await update($, variantAt, n => n + 1)
  awaitVariant($, surface, at + 1)
  void writeReport($)
}

function awaitVariant($: Engine, surface: string, at: number) {
  const variant = VARIANT_NAMES[at]
  if (variant === undefined) return
  $.clock.after(VARIANT_WAIT_MS, () => void settle($, surface, variant, 'no word'))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prg-spike', description: 'Open the prg-spike pane' })
    await $.command.register({
      name: 'prg-spike-spawn',
      description: 'Spawn the prg-spike worker from a typed command',
      argumentHint: '[live|stopped-allow|stopped-refuse]',
    })
    await $.tool.register({
      name: 'answer',
      description: "Only for the prg-spike worker: hands back one round's answer. Never call it from the main conversation.",
      inputSchema: {
        type: 'object',
        properties: { round: { type: 'number' }, text: { type: 'string' } },
        required: ['round', 'text'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'spawn_worker',
      description: 'Starts the prg-spike test worker. Call it only when the person asks you to spawn the prg-spike worker.',
      inputSchema: {
        type: 'object',
        properties: { resume: { type: 'string', enum: ['live', 'stopped-allow', 'stopped-refuse'] } },
      },
      isDeferred: false,
    })
    await $.agent.register({
      name: 'worker',
      description: 'Internal to the prg-spike mod; never delegate to it.',
      prompt: WORKER_PROMPT,
      tools: [ANSWER, 'Read'],
      model: 'opus',
      omitClaudeMd: true,
    })
    const started = await next(e)
    void $.ui.open({ id: PANE, title: 'prg-spike' })
    void probe($)
    // The worker runs change state from hooks of their own, so the report is rewritten on a timer.
    $.clock.every(5000, () => void writeReport($))
    return started
  })

  // Spawning inside the model's own tool call, to see whether auto mode judges a spawn made from a turn.
  on('tool.call', { tool: 'mcp__prg-spike__spawn_worker' }, async ($, e) => {
    if (e.agentId !== undefined) return { deny: 'prg-spike: spawn_worker is for the main conversation.' }
    const resume = parseResume((e as unknown as { resume?: unknown }).resume)
    const run = await startRun($, 'tool', resume)
    return { result: run.spawnDeny === null ? `${run.id}: spawned ${run.agentId ?? '?'} on ${run.model ?? '?'}` : `${run.id}: refused, ${run.spawnDeny}` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'prg-spike: spawn_worker failed.' }))

  on('command.run', { command: 'prg-spike-spawn' }, async ($, e) => {
    const run = await startRun($, 'command', parseResume(e.args.trim()))
    return { text: run.spawnDeny === null ? `${run.id}: spawned ${run.agentId ?? '?'}` : `${run.id}: refused, ${run.spawnDeny}` }
  })

  registerRuns(on)

  on('command.run', { command: 'prg-spike' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'prg-spike' })
    return { text: opened.isPlaced ? 'prg-spike pane opened.' : `prg-spike pane not placed: ${opened.reason}` }
  })

  on('ui.message', async ($, e, next) => {
    const data = (e.data ?? {}) as Record<string, unknown>
    if (data.kind === 'drawn' && e.element.startsWith('v-')) {
      await settle($, e.surface, e.element.slice(2), 'drew')
    } else if (data.kind === 'drawn') {
      await update($, drawn, list => (list.includes(e.element) ? list : [...list, e.element]))
      void writeReport($)
    }
    if (data.kind === 'click' && typeof data.y === 'number') {
      const got: Click = {
        surface: e.surface,
        mode: data.mode === 'text' ? 'text' : data.mode === 'buttons' ? 'buttons' : 'code',
        via: data.via === 'key' ? 'key' : 'pointer',
        x: Number(data.x) || 0,
        y: data.y,
        line: typeof data.line === 'number' ? data.line : null,
        text: typeof data.text === 'string' ? clip(data.text, 200) : null,
        columns: Number(data.columns) || 0,
        rows: Number(data.rows) || 0,
      }
      await update($, click, () => got)
      void writeReport($)
    }
    return next(e)
  })

  on('ui.fault', async ($, e, next) => {
    if (e.element.startsWith('v-')) {
      await settle($, e.surface, e.element.slice(2), 'refused', clip(String(e.reason), 200))
      return next(e)
    }
    const failed = new Set([...(await read($, faults)).map(fault => fault.element), e.element])
    const shown = `hunk-${await read($, mode)}-${await read($, size)}`
    const untried = VARIANTS.find(variant => !failed.has(`hunk-${variant.mode}-${variant.size}`))
    if (e.element === shown && untried !== undefined) {
      await update($, mode, () => untried.mode)
      await update($, size, () => untried.size)
    }
    await update($, faults, list =>
      [...list, { surface: e.surface, element: e.element, phase: String(e.phase), reason: clip(String(e.reason), 300) }].slice(-6),
    )
    void writeReport($)
    return next(e)
  })

  const card = ({ Box, Text }: Pick<Elements['terminal'], 'Box' | 'Text'>, text: string) => {
    const notes = [...text.matchAll(/^(n\d+) (\S+)$/gm)]
    return (
      <Box borderStyle="round" flexDirection="column" paddingX={1}>
        <Text bold>
          prg-spike · {notes.length} review notes sent to Claude
        </Text>
        {notes.map(match => (
          <Text dimColor>
            {match[1]} {match[2]}
          </Text>
        ))}
      </Box>
    )
  }

  on(
    'ui.render',
    { component: 'UserMessage', props: { origin: { kind: 'plugin', name: 'prg-spike' } } },
    async ($, e, next) => {
      if (e.props.isExpanded || (await read($, cardMode)) !== 'matcher') return next(e)
      return card($.ui.resolve(e), e.props.text)
    },
  )

  // With tagging on, every user row says the origin the engine gave it, so a row that never says so was never raised.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const tag = await read($, tagRows)
    const origin = e.props.origin
    const isOurs = origin.kind === 'plugin' && origin.name === 'prg-spike'
    const inHook = isOurs && (await read($, cardMode)) === 'in-hook'
    if (!tag && !inHook) return next(e)
    const body = inHook ? card($.ui.resolve(e), e.props.text) : await next(e)
    if (!tag) return body
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text dimColor>[prg-spike {BUILD} saw this UserMessage, origin {JSON.stringify(origin)}]</Text>
        {body}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button, Markdown, Code } = elements
    const Client = 'Client' in elements ? elements.Client : undefined
    const current = await read($, view)
    const version = await $.session.version()
    const here: Layout = {
      surface: e.surface,
      bodyColumns: e.props.bodyColumns,
      placement: e.props.placement,
      viewportColumns: e.viewport?.columns ?? null,
      viewportRows: e.viewport?.rows ?? null,
      isFullscreen: e.viewport?.isFullscreen ?? null,
      bodyRows: e.props.scroll.bodyRows,
    }
    const show = (to: View) => async () => {
      await update($, layout, () => here)
      await update($, view, () => to)
      await writeReport($)
    }
    const tab = (to: View, label: string, hotkey: string) => (
      <Button
        key={`tab-${to}`}
        label={label}
        hotkey={hotkey}
        variant={current === to ? 'primary' : 'secondary'}
        onPress={show(to)}
      />
    )

    const header = (
      <Box flexDirection="column">
        <Text dimColor>
          prg-spike {BUILD} · {e.surface} · Claude Code {version.version} · body {e.props.bodyColumns} × {e.props.scroll.bodyRows} ·{' '}
          {e.props.placement}
          {e.viewport ? ` · viewport ${e.viewport.columns} × ${e.viewport.rows}` : ''}
        </Text>
        <Text dimColor wrap="truncate-start">
          from {$.plugin.root}
        </Text>
        <Box flexDirection="row" gap={1}>
          {tab('section', 'Section', '1')}
          {tab('hunk', 'Click a line', '2')}
          {tab('probes', 'gh and Linear', '3')}
          {tab('turns', 'Turns and worker', '4')}
        </Box>
      </Box>
    )

    if (current === 'section') {
      const guide = JSON.parse(await $.fs.read(`${$.plugin.root}/fixture/guide.json`)) as Guide
      const build = JSON.parse(await $.fs.read(`${$.plugin.root}/fixture/hunks.json`)) as Build
      const index = Math.min(await read($, section), guide.sections.length - 1)
      const shown = guide.sections[index]
      if (shown === undefined) return header
      const step = (by: number) => async () => {
        await update($, layout, () => here)
        await update($, section, n => (n + by + guide.sections.length) % guide.sections.length)
      }
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Box flexDirection="row" gap={1}>
            <Button key="prev" label="Previous" hotkey="p" onPress={step(-1)} />
            <Text dimColor>
              §{index + 1} of {guide.sections.length}
            </Text>
            <Button key="next" label="Next" hotkey="n" onPress={step(1)} />
          </Box>
          <Text bold>{shown.title}</Text>
          {shown.risk ? <Text color="warning">Risk: {shown.risk}</Text> : null}
          <Markdown key="why" text={`**Why.** ${shown.why}`} />
          <Markdown key="how" text={`**How.** ${shown.how}`} />
          {sectionFiles(build, shown).map(file => (
            <Box flexDirection="column" width="100%">
              <Text bold>{file.path}</Text>
              {file.hunks.map(hunk => (
                <Box width="100%">
                  <Code format="diff" path={file.path} source={unified(hunk)} />
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      )
    }

    if (current === 'hunk') {
      const shownMode = await read($, mode)
      const shownSize = await read($, size)
      const lines = HUNK.lines.slice(0, shownSize)
      const element = `hunk-${shownMode}-${shownSize}`
      const resize = (to: number) => async () => {
        await update($, layout, () => here)
        await update($, size, () => to)
      }
      const last = await read($, click)
      const failed = await read($, faults)
      const at = await read($, variantAt)
      const tried = (await read($, variants)).filter(result => result.surface === e.surface)
      const running = VARIANT_NAMES[at]
      const runVariants = async () => {
        await update($, layout, () => here)
        await update($, variants, list => list.filter(result => result.surface !== e.surface))
        await update($, variantAt, () => 0)
        awaitVariant($, e.surface, 0)
      }
      const variantRows = tried.map(result => (
        <Text color={result.result === 'drew' ? undefined : 'error'}>
          {result.variant}: {result.result}
          {result.reason ? ` (${result.reason})` : ''}
        </Text>
      ))
      const variantClient =
        running === undefined ? (
          at > 0 ? <Text dimColor>All {VARIANT_NAMES.length} variants tried.</Text> : null
        ) : Client ? (
          <Box flexDirection="column">
            <Text dimColor>Trying {running}…</Text>
            <Client key={`v-${running}`} module="./variant.tsx" props={{ variant: running }} />
          </Box>
        ) : (
          <Text dimColor>This surface draws no Client.</Text>
        )
      // A line pressed as a plain Button in the pane itself, with no Client in between.
      const pressLine = (line: number, text: string) => async () => {
        await update($, layout, () => here)
        await update($, click, (): Click => ({
          surface: e.surface,
          mode: 'buttons',
          via: 'button',
          x: 0,
          y: line,
          line,
          text: clip(text, 200),
          columns: e.props.bodyColumns,
          rows: lines.length,
        }))
        void writeReport($)
      }
      const pick = (to: 'code' | 'text' | 'buttons') => async () => {
        await update($, layout, () => here)
        await update($, mode, () => to)
      }
      const where =
        last === null
          ? 'No click yet.'
          : `Last ${last.via} on ${last.surface}: row ${last.y}, column ${last.x} → ${
              last.line !== null ? `line ${last.line}` : last.y === 0 ? 'the @@ header' : 'no line'
            } (${last.mode}; region ${last.columns} × ${last.rows})`
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Text>Click a line below. The gutter marks the row the module took the click for.</Text>
          <Box flexDirection="row" gap={1}>
            <Button
              key="mode-code"
              label="One Code element"
              variant={shownMode === 'code' ? 'primary' : 'secondary'}
              onPress={pick('code')}
            />
            <Button
              key="mode-text"
              label="A Text per line"
              variant={shownMode === 'text' ? 'primary' : 'secondary'}
              onPress={pick('text')}
            />
            <Button
              key="mode-buttons"
              label="A Button per line, no Client"
              variant={shownMode === 'buttons' ? 'primary' : 'secondary'}
              onPress={pick('buttons')}
            />
            {[200, 20, 5].map(n => (
              <Button
                key={`size-${n}`}
                label={`${n} lines`}
                variant={shownSize === n ? 'primary' : 'secondary'}
                onPress={resize(n)}
              />
            ))}
          </Box>
          <Text>{where}</Text>
          {last?.text ? (
            <Text dimColor wrap="truncate-end">
              {last.text}
            </Text>
          ) : null}
          <Text bold>Client variants</Text>
          <Button key="variants" label="Run the Client variants" hotkey="v" onPress={runVariants} />
          {variantRows}
          {variantClient}
          <Text bold>Clicking a line</Text>
          <Text dimColor>Drew: {(await read($, drawn)).join(', ') || 'none yet'}</Text>
          {failed.map(fault => (
            <Text color="error">
              Client {fault.element} failed on {fault.surface} ({fault.phase}): {fault.reason}
            </Text>
          ))}
          {shownMode === 'buttons' ? (
            <Box flexDirection="column">
              <Text dimColor>{headerFor(lines)}</Text>
              {lines.map(([op, text], index) => (
                // The marker sits outside the Button too, since the desktop drops colour inside one.
                <Box flexDirection="row">
                  <Text mono color={op === '+' ? 'diffAdded' : op === '-' ? 'diffRemoved' : undefined}>
                    {last?.mode === 'buttons' && last.line === index + 1 ? '›' : ' '}
                    {op === ' ' ? ' ' : op}
                  </Text>
                  <Button key={`l${index + 1}`} plain onPress={pressLine(index + 1, text)}>
                    <Text mono color={op === '+' ? 'diffAdded' : op === '-' ? 'diffRemoved' : undefined} wrap="truncate-end">
                      {text}
                    </Text>
                  </Button>
                </Box>
              ))}
            </Box>
          ) : Client ? (
            <Client
              key={element}
              module="./hunk.tsx"
              props={{ mode: shownMode, path: HUNK.path, header: headerFor(lines), lines }}
            />
          ) : (
            <Text dimColor>This surface draws no Client.</Text>
          )}
        </Box>
      )
    }

    if (current === 'probes') {
      const g = await read($, gh)
      const l = await read($, linear)
      const again = async () => {
        await update($, layout, () => here)
        await update($, gh, () => null)
        await update($, linear, () => null)
        await probe($)
      }
      const outcome = (ran: ProcRun) => (ran.error !== undefined ? `failed to start: ${ran.error}` : `exit ${ran.exitCode}`)
      return (
        <Box flexDirection="column" gap={1}>
          {header}
          <Button key="probe" label="Run the probes again" hotkey="r" onPress={again} />
          <Text bold>gh</Text>
          {g === null ? (
            <Text dimColor>Running…</Text>
          ) : (
            <Box flexDirection="column">
              <Text>
                As {g.user.stdout?.trim() ?? g.user.error} in {g.cwd}
              </Text>
              {g.found.map(ran => (
                <Text>
                  {ran.argv[0]} --version: {outcome(ran)} ({ran.ms} ms)
                </Text>
              ))}
              <Text dimColor wrap="truncate-end">
                PATH {g.path ?? '(unset)'}
              </Text>
              {g.auth ? (
                <Text>
                  gh auth status: {outcome(g.auth)}. {(g.auth.stdout || g.auth.stderr || '').trim().split('\n').slice(0, 3).join(' ')}
                </Text>
              ) : null}
              {g.checks ? (
                <Text>
                  gh pr checks 2: {outcome(g.checks)} in {g.checks.ms} ms;{' '}
                  {g.checkCount === null
                    ? `not JSON: ${(g.checks.stderr ?? '').trim().slice(0, 200)}`
                    : `${g.checkCount} checks ${JSON.stringify(g.buckets)}`}
                </Text>
              ) : null}
            </Box>
          )}
          <Text bold>Linear</Text>
          {l === null ? (
            <Text dimColor>Running…</Text>
          ) : l.server === null ? (
            <Text dimColor>No get_issue tool among {l.toolCount} tools, so no Linear and no calls.</Text>
          ) : (
            <Box flexDirection="column">
              <Text>
                Server {l.server} ({l.toolCount} tools listed)
              </Text>
              {l.calls.map(call => (
                <Text wrap="truncate-end">
                  {call.tool} {JSON.stringify(call.args)}:{' '}
                  {call.error !== undefined
                    ? `threw ${call.error}`
                    : `${call.isError ? 'isError' : 'ok'} in ${call.ms} ms, ${(call.text ?? '').split('\n')[0]}`}
                </Text>
              ))}
            </Box>
          )}
        </Box>
      )
    }

    const s = await read($, sent)
    const list = await read($, runs)
    const offered = await read($, offers)
    const tagging = await read($, tagRows)
    const shownCard = await read($, cardMode)
    const press = (fn: () => Promise<void>) => async () => {
      await update($, layout, () => here)
      await fn()
    }
    const cardButton = (to: CardMode, label: string) => (
      <Button
        key={`card-${to}`}
        label={label}
        variant={shownCard === to ? 'primary' : 'secondary'}
        onPress={press(async () => void (await update($, cardMode, () => to)))}
      />
    )
    const fromButton = async () => void (await startRun($, 'button', 'live'))
    return (
      <Box flexDirection="column" gap={1}>
        {header}
        <Text bold>Notes into the chat</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="send-notes" label="Send 2 notes to Claude" hotkey="s" onPress={press(() => sendNotes($))} />
          <Button
            key="tag-rows"
            label={`Label user rows: ${tagging ? 'on' : 'off'}`}
            onPress={press(async () => void (await update($, tagRows, isOn => !isOn)))}
          />
        </Box>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>Card:</Text>
          {cardButton('matcher', 'by matcher')}
          {cardButton('in-hook', 'by a check in the hook')}
          {cardButton('off', 'off')}
        </Box>
        <Text dimColor>{s === null ? 'Not sent yet.' : `prompt.submit from ${s.surface}: ${s.result}`}</Text>
        <Text bold>Worker runs</Text>
        <Text dimColor>
          Also: ask Claude to call spawn_worker (with resume live, stopped-allow or stopped-refuse), or type /prg-spike-spawn.
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="spawn" label="Spawn from this button" hotkey="w" onPress={press(fromButton)} />
          <Button
            key="spawn-timer"
            label="Spawn from a timer"
            hotkey="t"
            onPress={press(async () => {
              $.clock.after(0, () => void startRun($, 'timer', 'live'))
            })}
          />
        </Box>
        <Text dimColor>agent.offer asked {offered} times</Text>
        {list.map(run => (
          <Box flexDirection="column">
            <Text>{runLine(run)}</Text>
            {run.sends.map(line => (
              <Text dimColor>  round 2: {line}</Text>
            ))}
            {run.log.map(line => (
              <Text dimColor>  {line}</Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
