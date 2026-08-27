// Find packages that new rules should probably cover.
//
// Enumerating npm is hopeless — 6,000+ packages carry a "polyfill" keyword alone.
// Enumerating *platform features* is not: a bounded number reach Baseline each
// year, and web-features dates every one of them. So start from "what did the
// browser absorb recently" and work back to "which package existed to do that".
//
// Output is a candidate list for a human to review, never a rule.
//
//   node scripts/find-candidates.mjs --years 3 --min-downloads 5000

import { features } from 'web-features'
import { rules } from '../dist/rules/index.js'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : Number(args[index + 1])
}

const YEARS = flag('years', 3)
const MIN_DOWNLOADS = flag('min-downloads', 5000)
const TODAY = new Date('2026-08-26')

const covered = new Set(rules.flatMap((rule) => rule.packages))

/** Features that became Baseline recently enough that projects still carry the workaround. */
function recentFeatures() {
  const out = []
  for (const [id, feature] of Object.entries(features)) {
    if (!('status' in feature)) continue
    const date = feature.status.baseline_low_date
    if (!date) continue
    const years = (TODAY - new Date(date)) / (365.25 * 24 * 3600 * 1000)
    if (years <= YEARS) out.push({ id, name: feature.name ?? id, date })
  }
  return out.sort((a, b) => b.date.localeCompare(a.date))
}

/** Tokens worth matching on — drops the noise words that make npm search fuzzy. */
const STOP = new Set(['and', 'the', 'of', 'in', 'for', 'with', 'api', 'css', 'js', 'web', 'javascript', 'element', 'property'])

function tokensOf(feature) {
  return [...new Set([...feature.id.split('-'), ...feature.name.toLowerCase().split(/[^a-z0-9]+/)])]
    .filter((t) => t.length > 2 && !STOP.has(t))
}

// npm's search endpoint rate-limits hard (429) and a swallowed 429 looks exactly
// like "no candidates found" — the failure mode this whole tool exists to avoid.
// So: retry with backoff, cache across runs, and count what never succeeded.
const CACHE_PATH = new URL('.cache/npm-search.json', import.meta.url)
const cache = await readCache()
const failures = []

async function readCache() {
  try {
    const { readFileSync } = await import('node:fs')
    return new Map(Object.entries(JSON.parse(readFileSync(CACHE_PATH, 'utf8'))))
  } catch {
    return new Map()
  }
}

async function writeCache() {
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  mkdirSync(dirname(fileURLToPath(CACHE_PATH)), { recursive: true })
  writeFileSync(CACHE_PATH, JSON.stringify(Object.fromEntries(cache)))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function search(query) {
  const hit = cache.get(query)
  if (hit) return hit

  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=6`

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(url)

      if (response.status === 429) {
        const after = Number(response.headers.get('retry-after')) || 0
        await sleep(after ? after * 1000 : 500 * 2 ** attempt)
        continue
      }

      if (!response.ok) {
        await sleep(300 * 2 ** attempt)
        continue
      }

      const body = await response.json()
      const names = body.objects?.map((o) => o.package.name) ?? []
      cache.set(query, names)
      return names
    } catch {
      await sleep(300 * 2 ** attempt)
    }
  }

  failures.push(query)
  return []
}

async function downloadsFor(names) {
  const counts = new Map()

  // The bulk endpoint rejects the entire batch if it contains a scoped package,
  // so scoped names have to be asked for one at a time.
  const scoped = names.filter((name) => name.startsWith('@'))
  const plain = names.filter((name) => !name.startsWith('@'))

  for (let i = 0; i < plain.length; i += 100) {
    const chunk = plain.slice(i, i + 100)
    try {
      const response = await fetch(`https://api.npmjs.org/downloads/point/last-week/${chunk.join(',')}`)
      const body = await response.json()
      const entries = chunk.length === 1 ? { [chunk[0]]: body } : body
      for (const [name, value] of Object.entries(entries)) {
        if (value?.downloads) counts.set(name, value.downloads)
      }
    } catch {
      // a failed batch just means those candidates go unranked
    }
  }

  await mapLimit(scoped, 8, async (name) => {
    try {
      const response = await fetch(`https://api.npmjs.org/downloads/point/last-week/${name}`)
      const body = await response.json()
      if (body?.downloads) counts.set(name, body.downloads)
    } catch {
      // same
    }
  })

  return counts
}

async function mapLimit(items, limit, fn) {
  const results = []
  let cursor = 0
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        results[index] = await fn(items[index])
      }
    }),
  )
  return results
}

const targets = recentFeatures()
process.stderr.write(`searching npm for ${targets.length} features baselined in the last ${YEARS} years…\n`)

/** Plural-ish endings, so `queries` matches `query`. */
function stem(token) {
  return token.replace(/ies$/, 'y').replace(/s$/, '')
}

const hits = await mapLimit(targets, 2, async (feature) => {
  const names = [...new Set([
    ...(await search(`${feature.name} polyfill`)),
    ...(await search(`${feature.id} polyfill`)),
  ])]

  const tokens = tokensOf(feature).map(stem)

  // npm search ranks by popularity, not relevance, so it returns `ink` for
  // "skip-ink" and `baseline-browser-mapping` for "baseline-shift". Two filters
  // survive that: the name has to announce itself as a stand-in, and it has to
  // mention the feature.
  const relevant = names.filter((name) => {
    const flat = name.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (!/polyfill|ponyfill|shim/.test(flat)) return false

    const matched = tokens.filter((token) => flat.includes(token))
    if (matched.length >= 2) return true
    // One shared token is only convincing when the feature is a single distinctive
    // word — otherwise `homedir-polyfill` "matches" :dir() and `buffer-indexof`
    // "matches" ext-color-buffer-float.
    return tokens.length <= 2 && matched.length === 1 && matched[0].length >= 6
  })

  return { feature, names: relevant }
})

const byPackage = new Map()
for (const { feature, names } of hits) {
  for (const name of names) {
    if (!byPackage.has(name)) byPackage.set(name, { name, features: [] })
    byPackage.get(name).features.push(feature)
  }
}

await writeCache()
const counts = await downloadsFor([...byPackage.keys()])

const candidates = [...byPackage.values()]
  .map((entry) => ({ ...entry, downloads: counts.get(entry.name) ?? 0 }))
  .filter((entry) => entry.downloads >= MIN_DOWNLOADS)
  .sort((a, b) => b.downloads - a.downloads)

const fresh = candidates.filter((c) => !covered.has(c.name))
const known = candidates.filter((c) => covered.has(c.name))

const weekly = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}K`)

console.log(`# Rule candidates\n`)
if (failures.length) {
  console.log(`> **${failures.length} searches never succeeded** (npm rate limiting). This list is incomplete — re-run to fill it in; results are cached.\n`)
}
console.log(`${targets.length} features baselined in the last ${YEARS} years · ${fresh.length} candidates over ${MIN_DOWNLOADS.toLocaleString()} weekly downloads\n`)
console.log(`| weekly | package | replaced by | baseline |`)
console.log(`| --- | --- | --- | --- |`)
for (const c of fresh) {
  const feature = c.features[0]
  console.log(`| ${weekly(c.downloads)} | \`${c.name}\` | ${feature.name} (\`feature:${feature.id}\`) | ${feature.date} |`)
}

if (known.length) {
  console.log(`\n## Already covered\n`)
  console.log(known.map((c) => `\`${c.name}\` (${weekly(c.downloads)})`).join(' · '))
}
