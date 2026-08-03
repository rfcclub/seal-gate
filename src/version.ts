import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const _pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'))

/** Package version read from package.json at startup. */
export const VERSION: string = _pkg.version
