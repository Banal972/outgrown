import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readManifest, scanProject } from '../src/scan.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const APP = join(FIXTURES, 'app')

describe('scanProject', () => {
  const project = scanProject(APP)
  const packages = [...project.usage.keys()]

  it('picks up side-effect imports', () => {
    expect(packages).toContain('whatwg-fetch')
    expect(project.usage.get('whatwg-fetch')?.files.has('src/boot.js')).toBe(true)
  })

  // Regression: one combined pattern let `import 'whatwg-fetch'` swallow the
  // line below it, and `aos` inherited its specifiers.
  it('does not let a side-effect import swallow the next line', () => {
    expect([...(project.usage.get('aos')?.specifiers ?? [])]).toEqual(['AOS'])
    expect([...(project.usage.get('whatwg-fetch')?.specifiers ?? [])]).toEqual([])
  })

  it('handles require() and dynamic import()', () => {
    expect(packages).toContain('react-modal')
    expect(packages).toContain('framer-motion')
  })

  it('normalises scoped packages with deep paths', () => {
    expect(packages).toContain('@floating-ui/react')
    expect(packages).not.toContain('@floating-ui/react/dist/floating-ui.react.mjs')
  })

  it('collects named specifiers', () => {
    const specifiers = [...(project.usage.get('@floating-ui/react')?.specifiers ?? [])]
    expect(specifiers).toEqual(expect.arrayContaining(['useFloating', 'offset', 'flip']))
  })

  it('stops at a nested package.json — that is a separate project', () => {
    expect(packages).not.toContain('intersection-observer')
  })

  it('records every file a package is used in', () => {
    expect([...(project.usage.get('framer-motion')?.files.keys() ?? [])].sort()).toEqual([
      'src/Gallery.jsx',
      'src/boot.js',
    ])
  })
})

describe('readManifest', () => {
  it('reads name and dependencies', () => {
    const manifest = readManifest(APP)
    expect(manifest?.name).toBe('fixture-app')
    expect(manifest?.dependencies).toHaveProperty('left-behind')
  })

  it('returns null when there is no package.json', () => {
    expect(readManifest(join(FIXTURES, 'does-not-exist'))).toBeNull()
  })
})

describe('re-exports', () => {
  // Measured against 530 real files: this was the one thing the regexes missed.
  //   export { useColorScheme } from "react-native"
  const project = scanProject(join(FIXTURES, 'reexport'))

  it('counts `export { x } from` as usage', () => {
    expect([...project.usage.keys()]).toContain('react-modal')
  })

  it('counts `export * from`', () => {
    expect([...project.usage.keys()]).toContain('aos')
  })

  it('collects the re-exported names', () => {
    expect([...(project.usage.get('react-modal')?.specifiers ?? [])]).toContain('Modal')
  })
})

describe('aliased imports', () => {
  const project = scanProject(join(FIXTURES, 'alias'))
  const usage = project.usage.get('resize-observer-polyfill')

  // Deleting the import has to leave the *local* name resolvable, so the local
  // name is what a safety check needs — not the name it was imported under.
  it('records the local binding, not just the imported name', () => {
    expect([...(usage?.specifiers ?? [])]).toContain('ResizeObserver')
    expect([...(usage?.bindings ?? [])]).toEqual(['RO'])
  })
})

describe('require and dynamic import', () => {
  const project = scanProject(join(FIXTURES, 'cjs'))

  it('captures the name a require is assigned to', () => {
    expect([...(project.usage.get('resize-observer-polyfill')?.bindings ?? [])]).toEqual(['RO'])
  })

  it('leaves a bare require unflagged — it binds nothing', () => {
    expect(project.usage.get('whatwg-fetch')?.opaque).toBe(false)
    expect([...(project.usage.get('whatwg-fetch')?.bindings ?? [])]).toEqual([])
  })

  // `foo(require('x'))` may be feeding a name this scanner cannot see.
  it('flags a call whose result goes somewhere it cannot follow', () => {
    expect(project.usage.get('intersection-observer')?.opaque).toBe(true)
  })
})

describe('a call whose result is used', () => {
  const project = scanProject(join(FIXTURES, 'consumed'))

  // `require('raf').polyfill()` starts a statement, so looking only backwards
  // calls it a side effect — while the result is very much in use.
  it('is not mistaken for a side-effect import', () => {
    expect(project.usage.get('raf')?.opaque).toBe(true)
  })
})
