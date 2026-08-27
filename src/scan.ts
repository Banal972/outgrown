import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import type { PackageUsage, Project } from './types.js'

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage',
  '.turbo', '.cache', '.svelte-kit', 'ios', 'android', '.venv', 'vendor',
])

const EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.vue', '.svelte', '.astro',
])

/**
 * Three separate patterns on purpose. Folding them into one alternation lets a
 * side-effect import (`import 'whatwg-fetch'`) swallow the line below it.
 */
const PATTERNS: { re: RegExp; clause: number | null; source: number }[] = [
  { re: /import\s+([^'";]+?)\s+from\s*['"]([^'"]+)['"]/g, clause: 1, source: 2 },
  { re: /import\s*['"]([^'"]+)['"]/g, clause: null, source: 1 },
  { re: /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g, clause: null, source: 1 },
  // Re-exports pull the package in just as an import does.
  { re: /export\s+(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s*['"]([^'"]+)['"]/g, clause: 1, source: 2 },
]

function walk(dir: string, out: string[]): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      // A nested package.json means a separate project (example, fixture, workspace).
      if (existsSync(join(full, 'package.json'))) continue
      walk(full, out)
    } else if (EXTENSIONS.has(extname(entry.name))) {
      out.push(full)
    }
  }

  return out
}

/** `{ motion, AnimatePresence }` · `React` · `* as X` → binding names. */
function parseSpecifiers(clause: string | null): string[] {
  if (!clause) return []
  const names: string[] = []

  const braces = clause.match(/\{([\s\S]*?)\}/)
  if (braces?.[1]) {
    for (const part of braces[1].split(',')) {
      const [source, alias] = part.trim().split(/\s+as\s+/).map((piece) => piece.trim())
      // `{ default as Modal }` — the alias is the only informative half.
      const name = source === 'default' ? alias : source
      if (name) names.push(name)
    }
  }

  const bare = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, ' ').trim()
  for (const token of bare.split(/\s+/)) {
    if (!token || token === '*' || token === 'as' || token === 'type') continue
    names.push(token)
  }

  return names
}

/** '@floating-ui/react/utils' → '@floating-ui/react'; relative paths → null. */
function packageOf(source: string): string | null {
  if (source.startsWith('.') || source.startsWith('/')) return null
  const parts = source.split('/')
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? null)
}

/** Walk the source tree and record which package is used where, and as what. */
export function scanProject(root: string): Project {
  const files = walk(root, [])
  const usage = new Map<string, PackageUsage>()

  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    for (const { re, clause, source } of PATTERNS) {
      re.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = re.exec(text))) {
        const specifier = match[source]
        if (!specifier) continue
        const pkg = packageOf(specifier)
        if (!pkg) continue

        let record = usage.get(pkg)
        if (!record) {
          record = { files: new Map(), specifiers: new Set() }
          usage.set(pkg, record)
        }

        const rel = relative(root, file)
        let fileUsage = record.files.get(rel)
        if (!fileUsage) {
          fileUsage = { lines: [], text }
          record.files.set(rel, fileUsage)
        }
        fileUsage.lines.push(text.slice(0, match.index).split('\n').length)

        for (const name of parseSpecifiers(clause === null ? null : (match[clause] ?? null))) {
          record.specifiers.add(name)
        }
      }
    }
  }

  return { root, fileCount: files.length, usage }
}

export interface Manifest {
  name?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export function readManifest(root: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest
  } catch {
    return null
  }
}

export function directorySize(dir: string): number {
  let total = 0
  const stack = [dir]

  while (stack.length) {
    const current = stack.pop()
    if (!current) break
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
      } else {
        try {
          total += statSync(full).size
        } catch {
          // unreadable file — not worth failing the whole scan over
        }
      }
    }
  }

  return total
}
