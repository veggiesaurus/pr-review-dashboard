import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Answer, Click, GhProbe, Layout, LinearProbe, McpRun, ProcRun, View, Worker } from '../types'
import { headerFor, madeUpHunk, sectionFiles, unified } from './data'
import type { Build, Guide } from './data'

type Engine = EngineInterface

const PANE = 'prg-spike'
// Bumped on every edit, so the pane shows which copy of the mod is running.
const BUILD = 'b5'
const WORKER = 'prg-spike:worker'
const ANSWER = 'mcp__prg-spike__answer'

const view = atom({ plugin: 'prg-spike', key: 'view' } as const, 'section')
const section = atom({ plugin: 'prg-spike', key: 'section' } as const, 0)
const mode = atom({ plugin: 'prg-spike', key: 'mode' } as const, 'code')
const size = atom({ plugin: 'prg-spike', key: 'size' } as const, 200)
const offers = atom({ plugin: 'prg-spike', key: 'offers' } as const, 0)
const layout = atom({ plugin: 'prg-spike', key: 'layout' } as const, null, { shape: 'layout-1' })
const click = atom({ plugin: 'prg-spike', key: 'click' } as const, null, { shape: 'click-1' })
const drawn = atom({ plugin: 'prg-spike', key: 'drawn' } as const, [], { shape: 'drawn-2' })
const faults = atom({ plugin: 'prg-spike', key: 'faults' } as const, [], { shape: 'faults-3' })
const gh = atom({ plugin: 'prg-spike', key: 'gh' } as const, null, { shape: 'gh-1' })
const linear = atom({ plugin: 'prg-spike', key: 'linear' } as const, null, { shape: 'linear-1' })
const sent = atom({ plugin: 'prg-spike', key: 'sent' } as const, null, { shape: 'sent-1' })

const IDLE: Worker = { phase: 'idle', agentId: null, model: null, listedAs: null, answers: [], refusedMain: 0, log: [] }
const worker = atom({ plugin: 'prg-spike', key: 'worker' } as const, IDLE, { shape: 'worker-2' })

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

const WORKER_PROMPT = [
  'You are a test worker for the prg-spike mod. Each message you get names a round number and a word.',
  `Call ${ANSWER} once with that round and a text made of the word and one short sentence about it.`,
  'Then reply with the single word done. Use no other tool.',
].join('\n')

let resuming = false

const round = (n: number, word: string) => `Round ${n}. The word is "${word}".`

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
      worker: await read($, worker),
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

async function isWorker($: Engine, agentId: string | undefined): Promise<boolean> {
  if (agentId === undefined) return false
  if ((await read($, worker)).agentId === agentId) return true
  return (await $.agent.list()).some(agent => agent.id === agentId && (agent.type === WORKER || agent.type === 'worker'))
}

const note = (w: Worker, line: string): Worker => ({ ...w, log: [...w.log, line].slice(-30) })

async function spawnWorker($: Engine): Promise<void> {
  await update($, worker, w => note({ ...IDLE, refusedMain: w.refusedMain, log: w.log }, '— spawning'))
  const ask = () => $.agent.spawn({ subagentType: WORKER, prompt: round(1, 'harbour'), description: 'prg-spike worker' })
  let spawned = await ask()
  if (spawned.deny !== undefined && /no verdict/.test(spawned.deny)) {
    await update($, worker, w => note(w, `spawn denied once, trying again: ${clip(spawned.deny ?? '', 120)}`))
    spawned = await ask()
  }
  if (spawned.deny !== undefined) {
    await update($, worker, w => note({ ...w, phase: 'failed' }, `spawn denied: ${spawned.deny}`))
    await writeReport($)
    return
  }
  const listed = (await $.agent.list()).find(agent => agent.id === spawned.agentId)
  await update($, worker, w =>
    note(
      {
        ...w,
        phase: w.phase === 'idle' ? 'spawned' : w.phase,
        agentId: spawned.agentId ?? null,
        model: spawned.model,
        listedAs: listed ? `${listed.type} (${listed.status})` : null,
      },
      `spawned ${spawned.agentId ?? '?'} on ${spawned.model}; listed as ${listed?.type ?? '?'}`,
    ),
  )
  await writeReport($)
}

async function sendRoundTwo($: Engine, agentId: string): Promise<void> {
  await update($, worker, w => note({ ...w, phase: 'sent-2' }, 'sending round 2'))
  try {
    resuming = true
    const sentTo = await $.session.send({ to: { agentId }, text: round(2, 'lantern') }).finally(() => {
      resuming = false
    })
    await update($, worker, w =>
      sentTo.isDelivered
        ? note(w, 'round 2 delivered')
        : note({ ...w, phase: 'failed' }, `round 2 not delivered: ${sentTo.reason}`),
    )
  } catch (error) {
    await update($, worker, w => note({ ...w, phase: 'failed' }, `round 2 send threw: ${String(error)}`))
  }
  await writeReport($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prg-spike', description: 'Open the prg-spike pane' })
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
    await $.agent.register({
      name: 'worker',
      description: 'Internal to the prg-spike mod; never delegate to it.',
      prompt: WORKER_PROMPT,
      tools: [ANSWER],
      model: 'opus',
      omitClaudeMd: true,
    })
    const started = await next(e)
    void $.ui.open({ id: PANE, title: 'prg-spike' })
    void probe($)
    return started
  })

  on('command.run', { command: 'prg-spike' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: 'prg-spike' })
    return { text: opened.isPlaced ? 'prg-spike pane opened.' : `prg-spike pane not placed: ${opened.reason}` }
  })

  // Resuming a finished agent asks agent.offer too, so the mod lets its own resume through.
  on('agent.offer', { agent: WORKER }, async $ => {
    await update($, offers, n => n + 1)
    return { isOffered: resuming }
  }).catch(() => ({ isOffered: false }))

  on('tool.call', { tool: ANSWER }, async ($, e) => {
    await update($, worker, w => note(w, `answer tool.call heard, agentId ${e.agentId ?? 'main'}`))
    if (!(await isWorker($, e.agentId))) {
      await update($, worker, w => ({ ...w, refusedMain: w.refusedMain + 1 }))
      return { deny: 'prg-spike: this tool is for the spike worker only.' }
    }
    const input = e as unknown as { round?: unknown; text?: unknown }
    const answer: Answer = { round: Number(input.round) || 0, text: clip(String(input.text ?? ''), 300), via: 'tool' }
    await update($, worker, w => note({ ...w, answers: [...w.answers, answer] }, `answer tool, round ${answer.round}, from ${e.agentId}`))
    void writeReport($)
    return { result: `recorded round ${answer.round}` }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'prg-spike: the answer tool failed.' }))

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) {
      const type = (await $.agent.list()).find(agent => agent.id === e.agentId)?.type ?? '?'
      await update($, worker, w => note(w, `turn.complete heard for ${e.agentId} (${type}, ${e.reason})`))
    }
    if (!(await isWorker($, e.agentId))) return next(e)
    const before = await read($, worker)
    const turn: Answer = { round: before.phase === 'sent-2' ? 2 : 1, text: clip(e.answer, 300), via: 'turn' }
    await update($, worker, w =>
      note(
        { ...w, phase: w.phase === 'sent-2' ? 'answered-2' : 'answered-1', answers: [...w.answers, turn] },
        `turn complete (${e.reason}) in ${e.agentId}`,
      ),
    )
    if (before.phase === 'spawned' && e.agentId !== undefined && (before.agentId === null || e.agentId === before.agentId)) void sendRoundTwo($, e.agentId)
    else void writeReport($)
    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    const data = (e.data ?? {}) as Record<string, unknown>
    if (data.kind === 'drawn') {
      await update($, drawn, list => (list.includes(e.element) ? list : [...list, e.element]))
      void writeReport($)
    }
    if (data.kind === 'click' && typeof data.y === 'number') {
      const got: Click = {
        surface: e.surface,
        mode: data.mode === 'text' ? 'text' : 'code',
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

  on(
    'ui.render',
    { component: 'UserMessage', props: { origin: { kind: 'plugin', name: 'prg-spike' } } },
    async ($, e, next) => {
      if (e.props.isExpanded) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      const notes = [...e.props.text.matchAll(/^(n\d+) (\S+)$/gm)]
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
    },
  )

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
          {e.surface} · Claude Code {version.version} · body {e.props.bodyColumns} × {e.props.scroll.bodyRows} ·{' '}
          {e.props.placement}
          {e.viewport ? ` · viewport ${e.viewport.columns} × ${e.viewport.rows}` : ''}
        </Text>
        <Text dimColor wrap="truncate-start">
          prg-spike {BUILD} from {$.plugin.root}
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
      const pick = (to: 'code' | 'text') => async () => {
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
          <Text dimColor>Drew: {(await read($, drawn)).join(', ') || 'none yet'}</Text>
          {failed.map(fault => (
            <Text color="error">
              Client {fault.element} failed on {fault.surface} ({fault.phase}): {fault.reason}
            </Text>
          ))}
          {Client ? (
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
    const w = await read($, worker)
    const offered = await read($, offers)
    const press = (fn: () => Promise<void>) => async () => {
      await update($, layout, () => here)
      await fn()
    }
    return (
      <Box flexDirection="column" gap={1}>
        {header}
        <Text bold>Notes into the chat</Text>
        <Button key="send-notes" label="Send 2 notes to Claude" hotkey="s" onPress={press(() => sendNotes($))} />
        <Text dimColor>{s === null ? 'Not sent yet.' : `prompt.submit from ${s.surface}: ${s.result}`}</Text>
        <Text bold>Hidden worker</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="spawn" label="Spawn the worker" hotkey="w" onPress={press(() => spawnWorker($))} />
          <Button
            key="spawn-timer"
            label="Spawn from a timer"
            hotkey="t"
            onPress={press(async () => {
              $.clock.after(0, () => void spawnWorker($))
            })}
          />
        </Box>
        <Text>
          {w.phase} · agent {w.agentId ?? '–'} · model {w.model ?? '–'} · listed as {w.listedAs ?? '–'}
        </Text>
        <Text dimColor>
          agent.offer refused it {offered} times · calls to answer from outside the worker refused: {w.refusedMain}
        </Text>
        {w.answers.map(answer => (
          <Text>
            round {answer.round} by {answer.via}: {answer.text}
          </Text>
        ))}
        {w.log.map(line => (
          <Text dimColor>{line}</Text>
        ))}
      </Box>
    )
  })
}
