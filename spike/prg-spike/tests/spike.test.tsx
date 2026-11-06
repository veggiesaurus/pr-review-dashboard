import { expect, mock, test } from 'claude-code/testing'
import type { AgentInfo, On, PromptOrigin } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const ANSWER = 'mcp__prg-spike__answer'
const SPAWN = 'mcp__prg-spike__spawn_worker'

const PANE = {
  plugin: 'prg-spike',
  component: 'Pane',
  requestId: 'prg-spike',
  props: {
    title: 'prg-spike',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const GUIDE = {
  sections: [
    {
      title: 'Serve under a new prefix',
      why: 'Post links now [start with /blog](f3).',
      how: 'The path builder changes its prefix and the tests follow.',
      items: ['f3', 'f1'],
      risk: 'Old /posts links stop resolving.',
    },
  ],
}

const hunk = (id: string, start: number, header: string) => ({
  id,
  oldStart: start,
  oldLines: 2,
  newStart: start,
  newLines: 2,
  header,
  noise: null,
  lines: [
    [' ', start, start, 'export function postPath(title: string): string {'],
    ['-', start + 1, null, '  return `/posts/${slugify(title)}`;'],
    ['+', null, start + 1, '  return `/blog/${slugify(title)}`;'],
  ],
})

const BUILD = {
  files: [
    { id: 'f1', path: 'api/get-post.bru', status: 'modified', category: 'implementation', hunks: [hunk('f1h1', 16, 'tests {')] },
    { id: 'f3', path: 'src/posts.ts', status: 'modified', category: 'implementation', hunks: [hunk('f3h1', 3, '')] },
  ],
}

type Calls = {
  run: string[][]
  mcp: { server: string; tool: string; id?: unknown }[]
  toasts: string[]
  shown: string[]
}

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

// Nothing sits beneath the plugin in a test: these hooks stand for the engine, gh and Linear.
function standIn(on: On, options: { linear?: boolean; ghOnPath?: boolean; agents?: AgentInfo[] } = {}) {
  const calls: Calls = { run: [], mcp: [], toasts: [], shown: [] }
  const clock = mock.clock(on, { now: 1_000 })
  mock.env(on, { PATH: options.ghOnPath ? '/opt/homebrew/bin:/usr/bin' : '/usr/bin:/bin', TMPDIR: '/tmp' })
  on('session.version', () => ({ value: { version: '2.1.319' } }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
  on('session.repo', () => ({
    value: { root: '/repo', remote: 'git@github.com:veggiesaurus/pr-review-guide.git', internal: false, name: null },
  }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.id', () => ({ value: 's1' }))
  on('fs.read', (_, e) => ({ value: JSON.stringify(e.path.endsWith('guide.json') ? GUIDE : BUILD) }))
  on('fs.write', () => ({ value: undefined }))
  on('agent.list', () => ({ value: options.agents ?? [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'prg-spike' } }))
  on('tool.register', () => ({ value: { tool: ANSWER } }))
  on('agent.register', () => ({ value: { agent: 'prg-spike:worker' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.toast', (_, e) => {
    calls.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_, e) => {
    if (e.to === 'transcript') calls.shown.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    calls.run.push([...e.argv])
    const [command, first] = e.argv
    if (command === 'gh' && !options.ghOnPath) return { deny: 'spawn gh ENOENT' }
    if (command === '/usr/local/bin/gh') return { deny: 'spawn /usr/local/bin/gh ENOENT' }
    if (command === 'id') return { value: ok('angus\n') }
    if (command === 'mkdir') return { value: ok('') }
    if (first === '--version') return { value: ok('gh version 2.83.0 (2026-10-01)\n') }
    if (first === 'auth') {
      return { value: ok('github.com\n  ✓ Logged in to github.com account angus\n  - Token: gho_****\n') }
    }
    if (first === 'pr') {
      const rows = [
        { name: 'test', state: 'SUCCESS', bucket: 'pass', link: 'https://example.invalid/1' },
        { name: 'lint', state: 'FAILURE', bucket: 'fail', link: 'https://example.invalid/2' },
      ]
      return { value: ok(JSON.stringify(rows)) }
    }
    return { value: { ...ok(''), exitCode: 127, stderr: `unexpected ${e.argv.join(' ')}` } }
  })
  on('tool.list', () => ({
    value: [
      { name: 'Read', description: 'Reads a file.', mcp: false },
      ...(options.linear
        ? [
            { name: 'mcp__claude_ai_Linear__list_issues', description: 'Lists issues.', mcp: true },
            { name: 'mcp__claude_ai_Linear__get_issue', description: 'Gets an issue.', mcp: true },
          ]
        : []),
    ],
  }))
  on('mcp.call', (_, e) => {
    calls.mcp.push({ server: e.server, tool: e.tool, id: e.args.id })
    const known = e.tool === 'list_issues' || e.args.id === 'BAC-1'
    const text = e.tool === 'list_issues' ? '[{"identifier":"BAC-1","title":"A title"}]' : known ? 'BAC-1: A title' : 'Issue not found'
    return { value: { content: [{ type: 'text', text }], isError: !known } }
  })
  return { calls, clock }
}

test('the pane draws one section of the guide, its hunks as diffs, on terminal and desktop', async ($, on) => {
  standIn(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect((await ui.find({ type: 'Text', text: /body 48 × 40 · dock/ }))?.text).toContain(surface)
    expect((await ui.find({ type: 'Text', text: 'Serve under a new prefix' }))?.text).toBe('Serve under a new prefix')
    expect((await ui.find({ type: 'Markdown', text: /\*\*Why\.\*\* Post links/ }))?.key).toBe('why')
    const diffs = await ui.findAll({ type: 'Code' })
    expect(diffs.map(code => code.props.format)).toEqual(['diff', 'diff'])
    expect(diffs[0]?.text).toMatch(/^@@ -3,2 \+3,2 @@\n /)
    expect(diffs[1]?.text).toMatch(/^@@ -16,2 \+16,2 @@ tests \{\n /)
    await ui.unmount()
  }
})

test('a click on the 200-line hunk names the line clicked, on terminal and desktop', async ($, on) => {
  standIn(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-hunk' })

    for (const mode of ['code', 'text']) {
      const hunk = `hunk-${mode}-200`
      await ui.press({ key: `mode-${mode}` })
      await ui.pointer({ type: 'down', x: 4, y: 42, button: 'left', in: hunk })
      expect((await ui.find({ type: 'Text', text: /^Last pointer/ }))?.text).toMatch(/row 42, column 4 → line 42/)
      expect((await ui.find({ type: 'Text', text: /L042/ }))?.text).toContain('rows[42]')
      const marks = await ui.findAll({ type: 'Text', in: hunk })
      expect(marks.findIndex(mark => mark.text === '›')).toBe(42)

      await ui.pointer({ type: 'down', x: 4, y: 0, button: 'left', in: hunk })
      expect((await ui.find({ type: 'Text', text: /^Last pointer/ }))?.text).toMatch(/→ the @@ header/)
    }

    await ui.key({ key: 'down', in: 'hunk-text-200' })
    expect((await ui.find({ type: 'Text', text: /^Last key/ }))?.text).toMatch(/→ line 1 /)
    await ui.unmount()
  }
})

test('gh is found where the PATH misses it, and its checks read as JSON', async ($, on) => {
  const { calls } = standIn(on, { ghOnPath: false })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-probes' })
  await ui.press({ key: 'probe' })

  expect(await ui.find({ type: 'Text', text: /^gh --version: failed to start/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\/opt\/homebrew\/bin\/gh --version: exit 0/ })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^gh pr checks 2/ }))?.text).toMatch(/exit 0 .*2 checks \{"pass":1,"fail":1\}/)
  expect(calls.run).toContainEqual(['/opt/homebrew/bin/gh', 'pr', 'checks', '2', '--json', 'name,state,bucket,link'])
  expect(await ui.find({ type: 'Text', text: /gho_/ })).toBeUndefined()
  await ui.unmount()
})

test('with Linear in the session, issues are read through its server', async ($, on) => {
  const { calls } = standIn(on, { linear: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-probes' })
  await ui.press({ key: 'probe' })

  expect(calls.mcp).toEqual([
    { server: 'claude_ai_Linear', tool: 'list_issues', id: undefined },
    { server: 'claude_ai_Linear', tool: 'get_issue', id: 'BAC-1' },
    { server: 'claude_ai_Linear', tool: 'get_issue', id: 'ZZZ-99999' },
  ])
  expect(await ui.find({ type: 'Text', text: /get_issue \{"id":"ZZZ-99999"\}: isError/ })).toBeDefined()
  await ui.unmount()
})

test('without Linear nothing is called, shown or logged about it', async ($, on) => {
  const { calls } = standIn(on, { linear: false })
  await $.session.start({ cwd: '/repo', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-probes' })
  await ui.press({ key: 'probe' })

  expect(calls.mcp).toEqual([])
  expect(calls.toasts).toEqual([])
  expect(calls.shown).toEqual([])
  await ui.unmount()
})

test('Send puts the notes in as a plugin turn, drawn as a compact card', async ($, on) => {
  standIn(on)
  const submitted: { text: string; origin: unknown }[] = []
  on('prompt.submit', (_, e) => {
    submitted.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-turns' })
  await ui.press({ key: 'send-notes' })
  expect(submitted).toHaveLength(1)
  expect(submitted[0]?.origin).toEqual({ kind: 'plugin', name: 'prg-spike' })
  expect(submitted[0]?.text).toContain('n1 src/posts.ts:R4@7176310')
  expect((await ui.find({ type: 'Text', text: /^prompt.submit/ }))?.text).toMatch(/entered/)
  await ui.unmount()

  const text = submitted[0]?.text ?? ''
  for (const surface of SURFACES) {
    const row = (origin: PromptOrigin, isExpanded: boolean) =>
      $.ui.mount({ plugin: 'prg-spike', component: 'UserMessage', requestId: 'm1', surface, props: { text, origin, isExpanded } })

    const card = await row({ kind: 'plugin', name: 'prg-spike' }, false)
    expect((await card.find({ type: 'Text', text: /review notes/ }))?.text).toBe('prg-spike · 2 review notes sent to Claude')
    expect(await card.find({ type: 'Text', text: 'n2 tests/posts.test.ts:R3@7176310' })).toBeDefined()
    await card.unmount()

    const full = await row({ kind: 'plugin', name: 'prg-spike' }, true)
    expect((await full.find({ type: 'Text' }))?.text).toBe('engine')
    await full.unmount()

    const typed = await row({ kind: 'composer' }, false)
    expect((await typed.find({ type: 'Text' }))?.text).toBe('engine')
    await typed.unmount()
  }
})

// The kit has no way to raise ui.fault, so stepping past a refused variant is checked in the app only.
test('a Client that stays drawn for a second reports itself, on terminal and desktop', async ($, on) => {
  standIn(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-hunk' })
    await ui.press({ key: 'size-5' })
    await ui.advance(1000)
    expect((await ui.find({ type: 'Text', text: /^Drew:/ }))?.text).toContain('hunk-code-5')
    await ui.unmount()
  }
})

// A stand-in can't start an agent (core alone sets agentId), so a run claims the worker by its listing.
const LISTED: AgentInfo = { id: 'a1', type: 'prg-spike:worker', description: 'prg-spike worker', status: 'running' }

test('a run hears every tool its worker calls, answers its tool and sends round 2', async ($, on) => {
  standIn(on, { agents: [LISTED] })
  const sent: string[] = []
  on('agent.spawn', () => ({ model: 'opus' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'README' }))
  on('session.send', (_, e) => {
    sent.push(e.text)
    return { isDelivered: true }
  })

  expect(
    await $.agent.offer({
      agent: 'prg-spike:worker',
      description: '',
      source: 'plugin',
      provider: { plugin: 'prg-spike', tier: 'user' },
    }),
  ).toEqual({ isOffered: false })
  expect((await $.tool.call({ tool: ANSWER, round: 1, text: 'sneaky' })).deny).toMatch(/worker only/)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'tab-turns' })
  await ui.press({ key: 'spawn' })

  await $.tool.call({ tool: 'Read', file_path: 'README.md', agentId: 'a1' })
  const answered = await $.tool.call({ tool: ANSWER, round: 1, text: 'harbour', agentId: 'a1' })
  expect(answered.result).toBe('recorded')
  await $.turn.complete({ agentId: 'a1', answer: 'done', reason: 'answer', durationMs: 5, isAborted: false, turnId: 't1' })

  expect(sent).toEqual(['Round 2. The word is "lantern".'])
  const line = (await ui.find({ type: 'Text', text: /^r1 from button/ }))?.text
  expect(line).toContain('heard Read×1, answer×1 · answered 1 · turns 1')
  expect((await ui.find({ type: 'Text', text: /round 2:/ }))?.text).toMatch(/offer let through: delivered/)
  await ui.unmount()
})

for (const resume of ['stopped-allow', 'stopped-refuse'] as const) {
  test(`spawn_worker with ${resume} waits for the worker to stop, then sends round 2`, async ($, on) => {
    const { clock } = standIn(on, { agents: [LISTED] })
    on('agent.spawn', () => ({ model: 'opus' }))
    // Stands for the engine resuming a stopped agent, which asks agent.offer first.
    on('session.send', async (_, e) => {
      const offer = await $.agent.offer({
        agent: 'prg-spike:worker',
        description: '',
        source: 'plugin',
        provider: { plugin: 'prg-spike', tier: 'user' },
      })
      return offer.isOffered ? { isDelivered: true } : { isDelivered: false, reason: `not offered: ${e.text}` }
    })

    expect((await $.tool.call({ tool: SPAWN, resume, agentId: 'a1' })).deny).toMatch(/main conversation/)
    expect((await $.tool.call({ tool: SPAWN, resume })).result).toMatch(/^r1: spawned/)
    await $.tool.call({ tool: ANSWER, round: 1, text: 'harbour', agentId: 'a1' })
    await $.turn.complete({ agentId: 'a1', answer: 'done', reason: 'answer', durationMs: 5, isAborted: false, turnId: 't1' })

    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'tab-turns' })
    expect(await ui.find({ type: 'Text', text: /round 2:/ })).toBeUndefined()
    await clock.advance(20_000)
    const said = (await ui.find({ type: 'Text', text: /round 2:/ }))?.text
    expect(said).toMatch(resume === 'stopped-allow' ? /offer let through: delivered/ : /offer refused: not delivered/)
    await ui.unmount()
  })
}

test('the card can come from the matcher or from a check in the hook, and rows can be labelled', async ($, on) => {
  standIn(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  const text = 'prg-spike: 1 review note\n\nn1 src/posts.ts:R4@7176310\nfix it'
  const row = (origin: PromptOrigin) =>
    $.ui.mount({ plugin: 'prg-spike', component: 'UserMessage', requestId: 'm1', surface: 'terminal', props: { text, origin, isExpanded: false } })
  const ours = { kind: 'plugin', name: 'prg-spike' } as const

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'tab-turns' })

  await pane.press({ key: 'card-in-hook' })
  const inHook = await row(ours)
  expect((await inHook.find({ type: 'Text', text: /review notes/ }))?.text).toBe('prg-spike · 1 review notes sent to Claude')
  await inHook.unmount()

  await pane.press({ key: 'card-off' })
  await pane.press({ key: 'tag-rows' })
  const typed = await row({ kind: 'composer' })
  expect((await typed.find({ type: 'Text', text: /saw this UserMessage/ }))?.text).toContain('origin {"kind":"composer"}')
  expect(await typed.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await typed.unmount()
  await pane.unmount()
})

test('the variant runner tries each Client variant in turn', async ($, on) => {
  standIn(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-hunk' })
    await ui.press({ key: 'variants' })
    for (let i = 0; i < 7; i++) await ui.advance(1000)
    const rows = await ui.findAll({ type: 'Text', text: /: drew$/ })
    expect(rows.map(r => r.text)).toEqual([
      'text: drew',
      'code-line: drew',
      'code-language: drew',
      'code-diff: drew',
      'code-diff-truncate: drew',
      'code-in-box: drew',
      'code-beside-gutter: drew',
    ])
    expect(await ui.find({ type: 'Text', text: 'All 7 variants tried.' })).toBeDefined()
    await ui.unmount()
  }
})

test('a hunk drawn as a Button per line in the pane names the line pressed, on terminal and desktop', async ($, on) => {
  standIn(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'tab-hunk' })
    await ui.press({ key: 'mode-buttons' })
    await ui.press({ key: 'size-20' })
    expect(await ui.findAll({ type: 'Button', key: 'l20' })).toHaveLength(1)
    await ui.press({ key: 'l7' })
    expect((await ui.find({ type: 'Text', text: /^Last button/ }))?.text).toMatch(/→ line 7 \(buttons/)
    expect(await ui.find({ type: 'Text', text: /^›/ })).toBeDefined()
    await ui.unmount()
  }
})
