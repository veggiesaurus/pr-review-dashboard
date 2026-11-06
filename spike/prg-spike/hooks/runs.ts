import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { Resume, Run, RunSource } from '../types'

type Engine = EngineInterface

export const WORKER = 'prg-spike:worker'
export const ANSWER = 'mcp__prg-spike__answer'

export const runs = atom({ plugin: 'prg-spike', key: 'runs' } as const, [], { shape: 'runs-1' })
export const offers = atom({ plugin: 'prg-spike', key: 'offers' } as const, 0)

export const WORKER_PROMPT = [
  'You are a test worker for the prg-spike mod. Each message you get names a round number and a word.',
  'For each one: first use Read on README.md with limit 3, then call',
  `${ANSWER} once with that round and a text made of the word and one short sentence about it,`,
  'then reply with the single word done. Use no other tool.',
].join('\n')

const round = (n: number, word: string) => `Round ${n}. The word is "${word}".`
const clip = (text: string, most: number) => (text.length > most ? `${text.slice(0, most)}…` : text)

// How long a run waits after the worker's first turn before sending round 2 to a worker that has stopped.
export const STOPPED_WAIT_MS = 20_000

let allowResume = false
let lastSpawnMode: string | null = null

async function change($: Engine, id: string, fn: (run: Run) => Run): Promise<void> {
  await update($, runs, list => list.map(run => (run.id === id ? fn(run) : run)))
}

const log = (line: string) => (run: Run): Run => ({ ...run, log: [...run.log, line].slice(-12) })

// A spawn whose result carried no agentId (as under the test kit) is claimed by the first listed worker seen.
async function runOf($: Engine, agentId: string | undefined): Promise<Run | undefined> {
  if (agentId === undefined) return undefined
  const list = await read($, runs)
  const known = list.find(run => run.agentId === agentId)
  if (known !== undefined) return known
  const open = list.find(run => run.agentId === null && run.spawnDeny === null)
  if (open === undefined) return undefined
  const listed = (await $.agent.list()).some(agent => agent.id === agentId && agent.type === WORKER)
  if (!listed) return undefined
  await change($, open.id, run => ({ ...run, agentId }))
  return { ...open, agentId }
}

export async function startRun($: Engine, source: RunSource, resume: Resume): Promise<Run> {
  const id = `r${(await read($, runs)).length + 1}`
  const fresh: Run = {
    id,
    source,
    resume,
    permissionMode: null,
    agentId: null,
    model: null,
    spawnDeny: null,
    seen: {},
    answered: 0,
    turns: 0,
    sends: [],
    log: [],
  }
  await update($, runs, list => [...list, fresh].slice(-12))
  lastSpawnMode = null
  const spawned = await $.agent.spawn({ subagentType: WORKER, prompt: round(1, 'harbour'), description: `prg-spike worker ${id}` })
  await change($, id, run => ({
    ...run,
    permissionMode: lastSpawnMode,
    agentId: spawned.agentId ?? null,
    model: spawned.model ?? null,
    spawnDeny: spawned.deny === undefined ? null : clip(spawned.deny, 200),
  }))
  return (await read($, runs)).find(run => run.id === id) ?? fresh
}

async function sendRoundTwo($: Engine, id: string, agentId: string, allow: boolean) {
  const status = (await $.agent.list()).find(agent => agent.id === agentId)?.status ?? 'not listed'
  allowResume = allow
  try {
    const sent = await $.session.send({ to: { agentId }, text: round(2, 'lantern') })
    const said = sent.isDelivered ? 'delivered' : `not delivered: ${clip(sent.reason, 200)}`
    await change($, id, run => ({ ...run, sends: [...run.sends, `worker ${status}, offer ${allow ? 'let through' : 'refused'}: ${said}`] }))
  } catch (error) {
    await change($, id, run => ({ ...run, sends: [...run.sends, `worker ${status}: send threw ${clip(String(error), 200)}`] }))
  } finally {
    allowResume = false
  }
}

export function registerRuns(on: On): void {
  on('agent.spawn', async ($, e, next) => {
    if (e.subagentType === WORKER) lastSpawnMode = e.permissionMode ?? null
    return next(e)
  }).catch(($, e, next) => next(e))

  // Resuming a stopped agent asks agent.offer too; a run decides whether its own resume is let through.
  on('agent.offer', { agent: WORKER }, async $ => {
    await update($, offers, n => n + 1)
    return { isOffered: allowResume }
  }).catch(() => ({ isOffered: false }))

  // Every tool call from a run's worker, whatever the tool, so a run shows whether the mod hears that loop at all.
  on('tool.call', async ($, e, next) => {
    const run = await runOf($, e.agentId)
    if (run !== undefined) {
      await change($, run.id, r => ({ ...r, seen: { ...r.seen, [e.tool]: (r.seen[e.tool] ?? 0) + 1 } }))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: ANSWER }, async ($, e) => {
    const run = await runOf($, e.agentId)
    if (run === undefined) return { deny: 'prg-spike: this tool is for the spike worker only.' }
    await change($, run.id, r => ({ ...r, answered: r.answered + 1 }))
    return { result: 'recorded' }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'prg-spike: the answer tool failed.' }))

  on('turn.complete', async ($, e, next) => {
    const run = await runOf($, e.agentId)
    if (run === undefined || e.agentId === undefined) return next(e)
    const agentId = e.agentId
    await change($, run.id, r => log(`turn ${r.turns + 1} (${e.reason}): ${clip(e.answer, 80)}`)({ ...r, turns: r.turns + 1 }))
    if (run.turns === 0) {
      const send = () => void sendRoundTwo($, run.id, agentId, run.resume !== 'stopped-refuse')
      if (run.resume === 'live') send()
      else $.clock.after(STOPPED_WAIT_MS, send)
    }
    return next(e)
  })
}

export function runLine(run: Run): string {
  const seen = Object.entries(run.seen)
    .map(([tool, n]) => `${tool.replace('mcp__prg-spike__', '')}×${n}`)
    .join(', ')
  const spawned = run.spawnDeny !== null ? `refused: ${run.spawnDeny}` : `${run.agentId ?? '?'} on ${run.model ?? '?'}`
  return `${run.id} from ${run.source} (${run.permissionMode ?? 'mode ?'}, resume ${run.resume}) · ${spawned} · heard ${seen || 'nothing'} · answered ${run.answered} · turns ${run.turns}`
}
