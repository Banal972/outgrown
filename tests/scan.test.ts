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
