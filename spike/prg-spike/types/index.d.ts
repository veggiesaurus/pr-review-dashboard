export type View = 'section' | 'hunk' | 'probes' | 'turns'

export type HunkMode = 'code' | 'text'

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
  via: 'pointer' | 'key'
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

export type WorkerPhase = 'idle' | 'spawned' | 'answered-1' | 'sent-2' | 'answered-2' | 'failed'

export type Answer = { round: number; text: string; via: 'tool' | 'turn' }

export type Worker = {
  phase: WorkerPhase
  agentId: string | null
  model: string | null
  listedAs: string | null
  answers: Answer[]
  refusedMain: number
  log: string[]
}

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
      worker: Shaped<Worker>
    }
  }
}
