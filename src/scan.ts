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
interface Pattern {
  re: RegExp
  clause: number | null
  source: number
  /** `call` matches may or may not bind a name; the rest are unambiguous. */
  form: 'binds' | 'side-effect' | 'call'
}

const PATTERNS: Pattern[] = [
  { re: /import\s+([^'";]+?)\s+from\s*['"]([^'"]+)['"]/g, clause: 1, source: 2, form: 'binds' },
  { re: /import\s*['"]([^'"]+)['"]/g, clause: null, source: 1, form: 'side-effect' },
  // `const RO = require('x')` and `const { a } = await import('x')` do bind names,
  // and those names have to survive deleting the import.
  {
    re: /(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*(?:await\s+)?(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    clause: 1,
    source: 2,
    form: 'binds',
  },
  { re: /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g, clause: null, source: 1, form: 'call' },
  // Re-exports pull the package in just as an import does.
  { re: /export\s+(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s*['"]([^'"]+)['"]/g, clause: 1, source: 2, form: 'binds' },
]

/**
 * Whether a bare require/import call is a side effect and nothing more.
 *
 * Both sides matter. `require('raf').polyfill()` starts a statement, so looking
 * only backwards calls it a side effect — while the result is very much in use.
 */
function isSideEffectOnly(text: string, start: number, end: number): boolean {
  let before = start - 1
  while (before >= 0 && /\s/.test(text[before] ?? '')) before--
  const precededByStatement = before < 0 || [';', '{', '}', ')'].includes(text[before] ?? '')

  let after = end
  while (after < text.length && /\s/.test(text[after] ?? '')) after++
  const consumed = ['.', '[', '(', '?'].includes(text[after] ?? '')

  return precededByStatement && !consumed
}

function walk(dir: string, out: string[], skipped: string[]): string[] {
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
      if (existsSync(join(full, 'package.json'))) {
        skipped.push(full)
        continue
      }
      walk(full, out, skipped)
    } else if (EXTENSIONS.has(extname(entry.name))) {
      out.push(full)
    }
  }

  return out
}

/**
 * `{ motion, AnimatePresence }` · `React` · `{ ResizeObserver as RO }`
 *
 * Returns both halves: what was imported (for display) and what it is bound to
 * locally (for deciding whether deleting the import is safe).
 */
function parseSpecifiers(clause: string | null): { imported: string[]; bound: string[] } {
  const imported: string[] = []
  const bound: string[] = []
  if (!clause) return { imported, bound }

  const braces = clause.match(/\{([\s\S]*?)\}/)
  if (braces?.[1]) {
    for (const part of braces[1].split(',')) {
      const [source, alias] = part.trim().split(/\s+as\s+/).map((piece) => piece.trim())
      if (!source) continue
      // `{ default as Modal }` — the alias is the only informative half.
      if (source !== 'default') imported.push(source)
      else if (alias) imported.push(alias)
      if (alias ?? source) bound.push((alias ?? source) as string)
    }
  }

  const bare = clause.replace(/\{[\s\S]*?\}/, '').replace(/,/g, ' ').trim()
  for (const token of bare.split(/\s+/)) {
    if (!token || token === '*' || token === 'as' || token === 'type') continue
    imported.push(token)
    bound.push(token)
  }

  return { imported, bound }
}

/** '@floating-ui/react/utils' → '@floating-ui/react'; relative paths → null. */
function packageOf(source: string): string | null {
  if (source.startsWith('.') || source.startsWith('/')) return null
  const parts = source.split('/')
  return source.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? null)
}

/** Walk the source tree and record which package is used where, and as what. */
export function scanProject(root: string): Project {
  const skipped: string[] = []
  const files = walk(root, [], skipped)
  const usage = new Map<string, PackageUsage>()

  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    // Ranges already claimed by a binding form, so the bare-call pattern does not
    // report the same require twice.
    const claimed: [number, number][] = []

    for (const { re, clause, source, form } of PATTERNS) {
      re.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = re.exec(text))) {
        if (form === 'call' && claimed.some(([from, to]) => match!.index >= from && match!.index < to)) continue
        if (form === 'binds') claimed.push([match.index, match.index + match[0].length])
        const specifier = match[source]
        if (!specifier) continue
        const pkg = packageOf(specifier)
        if (!pkg) continue

        let record = usage.get(pkg)
        if (!record) {
          record = { files: new Map(), specifiers: new Set(), bindings: new Set(), opaque: false }
          usage.set(pkg, record)
        }

        // A call that is not a statement on its own may be feeding a name we
        // cannot see — `foo(require('x'))`, `await import('x')`.
        if (form === 'call' && !isSideEffectOnly(text, match.index, match.index + match[0].length)) {
          record.opaque = true
        }

        const rel = relative(root, file)
        let fileUsage = record.files.get(rel)
        if (!fileUsage) {
          fileUsage = { lines: [], text }
          record.files.set(rel, fileUsage)
        }
        fileUsage.lines.push(text.slice(0, match.index).split('\n').length)

        const parsed = parseSpecifiers(clause === null ? null : (match[clause] ?? null))
        for (const name of parsed.imported) record.specifiers.add(name)
        for (const name of parsed.bound) record.bindings.add(name)
      }
    }
  }

  return { root, fileCount: files.length, usage, skipped: skipped.map((dir) => relative(root, dir)) }
}

/** Imports that only make sense on a server. */
const NODE_BUILTINS = new Set([
  'fs', 'path', 'child_process', 'os', 'http', 'https', 'net', 'worker_threads', 'readline', 'zlib',
])

/** Which Node builtins a project reaches for, if any. */
export function nodeSignalsIn(project: Project): string[] {
  const seen = new Set<string>()
  for (const pkg of project.usage.keys()) {
    const bare = pkg.startsWith('node:') ? pkg.slice(5) : pkg
    if (NODE_BUILTINS.has(bare)) seen.add(bare)
  }
  return [...seen].sort()
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
