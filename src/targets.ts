import browserslist from 'browserslist'
import type { BrowserKey, Minimums, Targets } from './types.js'

/** browserslist browser id → web-features (BCD) browser key. */
const CORE: Record<string, BrowserKey> = {
  chrome: 'chrome',
  and_chr: 'chrome_android',
  edge: 'edge',
  firefox: 'firefox',
  and_ff: 'firefox_android',
  safari: 'safari',
  ios_saf: 'safari_ios',
}

/**
 * Browsers web-features has no data for at all, and whose engines are not
 * tracking a core browser. Their support is unknown, not known to be absent:
 * IE 11 has requestAnimationFrame, so a blanket "never" would be its own kind of
 * made-up verdict.
 */
const NO_DATA = new Set(['ie', 'ie_mob', 'op_mini', 'bb', 'kaios'])

/** "16.0-16.3" · "26.1" · "TP" → the version to judge against, or null. */
function lowestVersion(raw: string): string | null {
  const first = raw.split('-')[0]?.trim() ?? ''
  if (!/^\d/.test(first)) return null // TP, "all", …
  return first
}

/**
 * Read the project's browserslist and reduce it to the lowest version of each
 * Baseline core browser. Non-core browsers (samsung, op_mob, ie, …) are left
 * out of the judgement — and reported, never silently dropped.
 */
/**
 * What to judge against when the project says nothing.
 *
 * browserslist' own defaults are market-share based, so they carry Opera Mini and
 * KaiOS — browsers web-features cannot judge, which would leave every verdict
 * capped and the report empty. Baseline's conservative line is an assumption too,
 * but a stated one that produces an answer.
 */
export const ASSUMED_QUERY = 'baseline widely available'

export function resolveTargets(cwd: string, override?: string): Targets {
  const configured = Boolean(override) || Boolean(browserslist.findConfig(cwd))
  const query = override ?? (configured ? undefined : ASSUMED_QUERY)
  const raw = browserslist(query, { path: cwd })

  const minimums: Minimums = {}
  const ignored = new Set<string>()
  const noData = new Set<string>()
  const derivative = new Set<string>()
  const unknownVersions: string[] = []
  const aheadOfStable: string[] = []
  const previews: { entry: string; key: BrowserKey }[] = []

  for (const entry of raw) {
    const [id, version] = entry.split(' ')
    const key = id ? CORE[id] : undefined
    if (!key) {
      if (!id) continue
      ignored.add(id)
      // Everything else — samsung, opera, baidu, uc — is a Chromium or WebKit
      // derivative: it does get these features, trailing the engine by an amount
      // web-features cannot tell us.
      if (NO_DATA.has(id)) noData.add(entry)
      else derivative.add(id)
      continue
    }
    const parsed = version ? lowestVersion(version) : null
    if (parsed === null) {
      // Technology Preview runs ahead of stable — but that only makes it
      // redundant when a stable version of the same browser is also in the query.
      // On its own it is the only thing constraining Safari, and skipping it would
      // leave Safari unjudged. Sorted out below, once the minimums are known.
      if (/^TP$/i.test(version ?? '')) previews.push({ entry, key })
      else unknownVersions.push(entry)
      continue
    }
    const current = minimums[key]
    if (!current || compareVersions(parsed, current) < 0) minimums[key] = parsed
  }

  for (const preview of previews) {
    if (minimums[preview.key]) aheadOfStable.push(preview.entry)
    else unknownVersions.push(preview.entry)
  }

  return {
    minimums,
    ignored: [...ignored],
    noData: [...noData],
    derivative: [...derivative],
    unknownVersions,
    aheadOfStable,
    source: override ? 'override' : configured ? 'project' : 'assumed',
    ...(configured ? {} : { assumedQuery: ASSUMED_QUERY }),
    raw,
  }
}

/** Dot-separated version compare. Negative when a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}
