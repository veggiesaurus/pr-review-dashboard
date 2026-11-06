export type Op = ' ' | '+' | '-'
export type HunkLine = [Op, number | null, number | null, string]

export type Hunk = {
  id: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  header: string
  noise: string | null
  lines: HunkLine[]
}

export type DiffFile = { id: string; path: string; status: string; category: string; hunks: Hunk[] }

export type Section = { title: string; why: string; how: string; items: string[]; risk?: string }

export type Build = { files: DiffFile[] }
export type Guide = { sections: Section[] }

export function unified(hunk: Hunk): string {
  const head = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
  return [hunk.header ? `${head} ${hunk.header}` : head, ...hunk.lines.map(([op, , , text]) => op + text)].join('\n')
}

export function sectionFiles(build: Build, section: Section): DiffFile[] {
  return section.items.flatMap(id => build.files.filter(file => file.id === id))
}

// The guide links to items by id ("[moves out](f4)"); the pane has nowhere to send those yet.
export function unlink(markdown: string): string {
  return markdown.replace(/\[([^\]]+)\]\((f\d+(?:h\d+)?)\)/g, '$1 ($2)')
}

export type PickLine = [Op, string]

export type MadeUpHunk = { path: string; header: string; lines: PickLine[] }

// Each line carries its own number (L001 to L200) near the start, so a reported line can be checked by eye.
export function madeUpHunk(): MadeUpHunk {
  const lines: PickLine[] = []
  for (let i = 1; i <= 200; i++) {
    const tag = `L${String(i).padStart(3, '0')}`
    const op: Op = i % 7 === 0 ? '-' : i % 5 === 0 ? '+' : ' '
    const tail =
      i % 9 === 0
        ? ` // ${'a trailing comment long enough to run past a docked pane, so truncate-end has something to cut; '.repeat(2)}`
        : ''
    lines.push([op, `  /* ${tag} */ total = weigh(total, rows[${i}], ${i % 3 === 0 ? 'heavy' : 'light'});${tail}`])
  }
  return { path: 'src/tally.ts', header: headerFor(lines), lines }
}

export function headerFor(lines: PickLine[]): string {
  const old = lines.filter(([op]) => op !== '+').length
  const now = lines.filter(([op]) => op !== '-').length
  return `@@ -101,${old} +101,${now} @@ function tally(rows: Row[]): number {`
}
