import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFile, referencesOutside, type ImportSite, type Node } from './parse.js'
import type { Report } from '../types.js'

export interface Removal {
  file: string
  line: number
  pkg: string
  /** The exact text that would disappear. */
  text: string
}

export interface Kept {
  file: string
  line: number
  pkg: string
  reason: string
}

export interface FixPlan {
  removals: Removal[]
  kept: Kept[]
  /** file → rewritten contents, only for files with at least one removal. */
  contents: Map<string, string>
  /** Packages with no remaining reference anywhere once the plan is applied. */
  uninstall: string[]
  /** Set when @babel/parser is missing — nothing can be planned without it. */
  error?: string
}

/** '@scope/name/deep' → '@scope/name' */
function packageOf(source: string): string | null {
  if (source.startsWith('.') || source.startsWith('/')) return null
  const parts = source.split('/')
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? null)
}

/** Remove a statement along with the newline it sat on, so no blank line is left. */
function cut(source: string, statement: Node): { text: string; start: number; end: number } {
  let start = statement.start
  let end = statement.end

  if (source[end] === ';') end++
  while (end < source.length && (source[end] === ' ' || source[end] === '\t')) end++
  if (source[end] === '\r') end++
  if (source[end] === '\n') end++

  // Take the indentation in front of it too.
  while (start > 0 && (source[start - 1] === ' ' || source[start - 1] === '\t')) start--

  return { text: source.slice(start, end), start, end }
}

/**
 * `ResizeObserver` matters: deleting `import ResizeObserver from
 * 'resize-observer-polyfill'` leaves the identifier resolving to the global of
 * the same name, so the surrounding code keeps working. The rule states that
 * global explicitly — guessing it from the replacement text got `unfetch` wrong,
 * whose binding is `fetch` while the text reads `window.fetch`.
 */
function decide(
  site: ImportSite,
  facts: Awaited<ReturnType<typeof readFile>>,
  native: string | undefined,
): string | null {
  if (!site.topLevel) return 'nested in a conditional or function — removing it would change behaviour'
  if (site.kind === 'dynamic') return 'dynamic import — usually loaded conditionally'
  if (!facts) return 'could not parse'

  for (const binding of site.bindings) {
    const uses = referencesOutside(facts, binding, site.statement)
    if (uses === 0) continue
    if (binding === native) continue // the global of the same name takes over
    return `\`${binding}\` is used ${uses} time${uses > 1 ? 's' : ''} in this file`
  }

  return null
}

/**
 * Work out what deleting the dead polyfills would actually change.
 *
 * Only findings the analyser already marked `drop` under the `polyfills` rule are
 * considered: that rule is the one where the replacement is *nothing*, so deletion
 * is the entire migration. Every other rule needs code written, not removed.
 */
export async function planPolyfillFix(root: string, report: Report): Promise<FixPlan> {
  const plan: FixPlan = { removals: [], kept: [], contents: new Map(), uninstall: [] }

  const targets = new Map<string, string | undefined>()
  for (const finding of report.findings) {
    if (finding.rule !== 'polyfills' || finding.verdict !== 'drop') continue
    targets.set(finding.pkg, finding.nativeGlobal)
  }
  if (!targets.size) return plan

  const files = new Set(
    report.findings
      .filter((finding) => targets.has(finding.pkg))
      .flatMap((finding) => finding.files),
  )

  const removalsByFile = new Map<string, { start: number; end: number }[]>()

  for (const file of files) {
    const absolute = join(root, file)
    let source: string
    try {
      source = readFileSync(absolute, 'utf8')
    } catch {
      continue
    }

    const facts = await readFile(source, file)
    if (!facts) {
      plan.error ??= '@babel/parser is required for `outgrown fix`. Install it: npm i -D @babel/parser'
      return plan
    }

    for (const site of facts.sites) {
      const pkg = packageOf(site.source)
      if (!pkg || !targets.has(pkg)) continue

      const reason = decide(site, facts, targets.get(pkg))
      if (reason) {
        plan.kept.push({ file, line: site.line, pkg, reason })
        continue
      }

      const { text, start, end } = cut(source, site.statement)
      plan.removals.push({ file, line: site.line, pkg, text: text.trimEnd() })
      const ranges = removalsByFile.get(file) ?? []
      ranges.push({ start, end })
      removalsByFile.set(file, ranges)
    }

    if (!removalsByFile.has(file)) continue

    // Apply back to front so earlier offsets stay valid.
    const ranges = [...(removalsByFile.get(file) ?? [])].sort((a, b) => b.start - a.start)
    let next = source
    for (const range of ranges) next = next.slice(0, range.start) + next.slice(range.end)

    // Removing the imports at the top leaves the blank line that followed them.
    if (ranges.some((range) => range.start === 0)) next = next.replace(/^[\r\n]+/, '')

    plan.contents.set(file, next)
  }

  const stillReferenced = new Set(plan.kept.map((k) => k.pkg))
  plan.uninstall = [...new Set(plan.removals.map((r) => r.pkg))]
    .filter((pkg) => !stillReferenced.has(pkg))
    .sort()

  return plan
}
