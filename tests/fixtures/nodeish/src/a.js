import { readFileSync } from 'fs'
import { join } from 'path'
import escape from 'escape-string-regexp'
export const read = (p) => escape(readFileSync(join(p), 'utf8'))
