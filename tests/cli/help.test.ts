import { it, expect } from 'bun:test'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url))
const run = (...args: string[]) => spawnSync('node', [cli, ...args], { encoding: 'utf-8' })

it('help-flags: --help, help and -h exit 0; misuse exits 2', () => {
  const help = ['--help', 'help', '-h'].map(flag => run(flag))
  expect(help.map(r => [r.status, r.stdout.includes('USAGE')])).toEqual([[0, true], [0, true], [0, true]])
  expect([run().status, run('no-such-command-or-file').status]).toEqual([2, 2])
})
