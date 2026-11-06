export type View = 'section' | 'hunk' | 'probes' | 'turns'

export type HunkMode = 'code' | 'text' | 'buttons'

export type Layout = {
  surface: string
  bodyColumns: number
  placement: 'dock' | 'inline'
  viewportColumns: number | null
  viewportRows: number | null
  isFullscreen: boolean | null
  bodyRows: number
}

export type Click = {
  surface: string
  mode: HunkMode
  via: 'pointer' | 'key' | 'button'
  x: number
  y: number
  line: number | null
  text: string | null
  columns: number
  rows: number
}

export type Fault = { surface: string; element: string; phase: string; reason: string }

export type ProcRun = {
  argv: string[]
  ms: number
  exitCode?: number
  stdout?: string
  stderr?: string
  error?: string
}

export type GhProbe = {
  surface: string
  cwd: string
  path: string | null
  user: ProcRun
  found: ProcRun[]
  gh: string | null
  auth: ProcRun | null
  checks: ProcRun | null
  checkCount: number | null
  buckets: Record<string, number> | null
}

export type McpRun = { tool: string; args: Record<string, unknown>; ms: number; isError?: boolean; error?: string; text?: string }

export type LinearProbe = {
  surface: string
  toolCount: number
  server: string | null
  calls: McpRun[]
}

export type Sent = { result: string; surface: string }

export type RunSource = 'tool' | 'button' | 'timer' | 'command'

// live: round 2 goes as the first turn ends. stopped-*: it goes once the worker has stopped,
// with the mod's agent.offer hook letting the resume through or refusing it.
export type Resume = 'live' | 'stopped-allow' | 'stopped-refuse'

export type Run = {
  id: string
  source: RunSource
  resume: Resume
  permissionMode: string | null
  agentId: string | null
  model: string | null
  spawnDeny: string | null
  seen: Record<string, number>
  answered: number
  turns: number
  sends: string[]
  log: string[]
}

export type VariantResult = { surface: string; variant: string; result: 'drew' | 'refused' | 'no word'; reason?: string }

export type CardMode = 'matcher' | 'in-hook' | 'off'

declare module 'claude-code' {
  interface PluginState {
    'prg-spike': {
      view: View
      section: number
      mode: HunkMode
      size: number
      offers: number
      layout: Shaped<Layout | null>
      click: Shaped<Click | null>
      faults: Shaped<Fault[]>
      drawn: Shaped<string[]>
      gh: Shaped<GhProbe | null>
      linear: Shaped<LinearProbe | null>
      sent: Shaped<Sent | null>
      runs: Shaped<Run[]>
      variants: Shaped<VariantResult[]>
      variantAt: number
      tagRows: boolean
      cardMode: CardMode
    }
  }
}
