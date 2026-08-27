import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { hasEsbuild, kb, measure } from '../src/size.js'
import { directorySize } from '../src/scan.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

describe('kb', () => {
  it('formats bytes to one decimal', () => {
    expect(kb(1024)).toBe('1.0KB')
    expect(kb(35_430)).toBe('34.6KB')
  })

  it('renders an em dash when there is no number', () => {
    expect(kb(null)).toBe('—')
  })
})

describe('directorySize', () => {
  it('adds up files recursively', () => {
    expect(directorySize(join(HERE, 'fixtures'))).toBeGreaterThan(0)
  })

  it('returns zero for a directory that is not there', () => {
    expect(directorySize(join(HERE, 'nope'))).toBe(0)
  })
})

describe('measure', () => {
  it('bundles and gzips a real package', async () => {
    if (!(await hasEsbuild())) return // optional peer

    const size = await measure('picocolors', REPO)
    expect(size.measured).toBe(true)
    expect(size.gzip).toBeGreaterThan(0)
    expect(size.min).toBeGreaterThan(size.gzip!)
  })

  it('reports failure instead of throwing when the package is not there', async () => {
    const size = await measure('this-package-does-not-exist', REPO)

    expect(size.measured).toBe(false)
    expect(size.gzip).toBeNull()
    expect(size.onDisk).toBeNull()
    expect(size.reason).toBeDefined()
  })
})
