import { extname } from 'node:path'

/**
 * Only the node shapes this codemod reads, declared structurally.
 *
 * Babel's own types would be a second dependency for a parser that is already an
 * optional peer, and the codemod touches a handful of node types.
 */
export interface Node {
  type: string
  start: number
  end: number
  loc?: { start: { line: number }; end: { line: number } }
  [key: string]: unknown
}

export interface ImportSite {
  /** The statement to remove, with byte offsets into the original source. */
  statement: Node
  source: string
  /** Local binding names this statement introduces. */
  bindings: string[]
  /** False when the statement sits inside an `if`, `try`, or function body. */
  topLevel: boolean
  kind: 'import' | 'require' | 'dynamic'
  line: number
}

export interface FileFacts {
  sites: ImportSite[]
  /** Every identifier occurrence, so a binding's uses can be counted. */
  identifiers: { name: string; start: number; end: number }[]
}

type Parse = (code: string, options: unknown) => { program: { body: Node[] } }

let parser: { parse: Parse } | null | undefined

/** `@babel/parser` is an optional peer — reporting works without it, `fix` does not. */
export async function loadParser(): Promise<{ parse: Parse } | null> {
  if (parser !== undefined) return parser
  try {
    parser = (await import('@babel/parser')) as unknown as { parse: Parse }
  } catch {
    parser = null
  }
  return parser
}

function pluginsFor(file: string): string[] {
  const ext = extname(file)
  const plugins = ['jsx']
  if (ext === '.ts' || ext === '.tsx' || ext === '.mts' || ext === '.cts') plugins.push('typescript')
  return plugins
}

function walk(node: unknown, visit: (node: Node) => void): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }

  const current = node as Node
  if (typeof current.type === 'string') visit(current)

  for (const key of Object.keys(current)) {
    if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue
    walk(current[key], visit)
  }
}

function stringValue(value: unknown): string | null {
  const node = value as { type?: string; value?: unknown } | undefined
  return node?.type === 'StringLiteral' && typeof node.value === 'string' ? node.value : null
}

function requireTarget(expression: unknown): string | null {
  const node = expression as Node | undefined
  if (node?.type !== 'CallExpression') return null
  const callee = node.callee as { type?: string; name?: string } | undefined
  if (callee?.type !== 'Identifier' || callee.name !== 'require') return null
  const args = (node.arguments ?? []) as unknown[]
  return stringValue(args[0])
}

function patternNames(pattern: unknown): string[] {
  const node = pattern as Node | undefined
  if (!node) return []
  if (node.type === 'Identifier') return [String(node.name)]

  const names: string[] = []
  walk(node, (child) => {
    if (child.type === 'Identifier') names.push(String(child.name))
  })
  return names
}

/**
 * Every place a module is pulled into one file, plus enough context to decide
 * whether removing it is safe.
 *
 * Top-level statements are handled explicitly so that `require()` and dynamic
 * `import()` are attributed to the statement that holds them; anything the walk
 * finds afterwards is by definition nested, and nested means conditional.
 */
export async function readFile(code: string, file: string): Promise<FileFacts | null> {
  const mod = await loadParser()
  if (!mod) return null

  let ast
  try {
    ast = mod.parse(code, { sourceType: 'unambiguous', plugins: pluginsFor(file), errorRecovery: true })
  } catch {
    return null
  }

  const sites: ImportSite[] = []
  const claimed = new Set<Node>()

  const push = (statement: Node, source: string, kind: ImportSite['kind'], bindings: string[], topLevel: boolean) => {
    sites.push({ statement, source, kind, bindings, topLevel, line: statement.loc?.start.line ?? 0 })
  }

  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration') {
      const source = stringValue(statement.source)
      if (!source) continue
      const specifiers = (statement.specifiers ?? []) as { local?: { name?: string } }[]
      const bindings = specifiers.map((s) => s.local?.name).filter((n): n is string => Boolean(n))
      claimed.add(statement)
      push(statement, source, 'import', bindings, true)
      continue
    }

    if (statement.type === 'ExpressionStatement') {
      const expression = statement.expression as Node | undefined
      const required = requireTarget(expression)
      if (required && expression) {
        claimed.add(expression)
        push(statement, required, 'require', [], true)
        continue
      }
      if (expression?.type === 'ImportExpression') {
        const source = stringValue(expression.source)
        if (source) {
          claimed.add(expression)
          push(statement, source, 'dynamic', [], true)
        }
      }
      continue
    }

    if (statement.type === 'VariableDeclaration') {
      const declarations = (statement.declarations ?? []) as Node[]
      if (declarations.length !== 1) continue
      const declaration = declarations[0]
      if (!declaration) continue
      const required = requireTarget(declaration.init)
      if (!required) continue
      claimed.add(declaration.init as Node)
      push(statement, required, 'require', patternNames(declaration.id), true)
    }
  }

  const identifiers: FileFacts['identifiers'] = []

  walk(ast.program.body, (node) => {
    if (node.type === 'Identifier') {
      identifiers.push({ name: String(node.name), start: node.start, end: node.end })
      return
    }

    if (claimed.has(node)) return

    if (node.type === 'ImportDeclaration') {
      const source = stringValue(node.source)
      if (source) push(node, source, 'import', [], false)
      return
    }

    if (node.type === 'ImportExpression') {
      const source = stringValue(node.source)
      if (source) push(node, source, 'dynamic', [], false)
      return
    }

    const required = requireTarget(node)
    if (required) push(node, required, 'require', [], false)
  })

  return { sites, identifiers }
}

/** How often a binding is used outside the statement that introduced it. */
export function referencesOutside(facts: FileFacts, name: string, statement: Node): number {
  return facts.identifiers.filter(
    (id) => id.name === name && (id.start < statement.start || id.end > statement.end),
  ).length
}
