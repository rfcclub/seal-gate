import { Seal } from './index.ts'
import { ArtifactType, RiskLevel } from './types.ts'
import { readFileSync, existsSync } from 'node:fs'

function usage() {
  console.error('Usage: seal review --output <file> [--spec <file>] [--evidence <file>] [--artifact-type <type>]')
  process.exit(2)
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] !== 'review') { usage(); return }

  let outputFile: string | null = null
  let specFile: string | null = null
  let evidenceFile: string | null = null
  let artifactType: ArtifactType = 'llm_response'

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--output' && args[i + 1]) { outputFile = args[++i] }
    else if (args[i] === '--spec' && args[i + 1]) { specFile = args[++i] }
    else if (args[i] === '--evidence' && args[i + 1]) { evidenceFile = args[++i] }
    else if (args[i] === '--artifact-type' && args[i + 1]) { artifactType = args[++i] as ArtifactType }
  }

  if (!outputFile) { usage(); return }
  if (!existsSync(outputFile)) { console.error(`Error: output file not found: ${outputFile}`); process.exit(2) }

  const output = readFileSync(outputFile, 'utf-8')
  const spec = specFile && existsSync(specFile) ? readFileSync(specFile, 'utf-8') : null
  const evidence = evidenceFile && existsSync(evidenceFile) ? JSON.parse(readFileSync(evidenceFile, 'utf-8')) : {
    test_log: '', build_log: '', diff: '', references: []
  }

  const verdict = await Seal.review({ artifact_type: artifactType, spec, output, evidence, risk_hint: null })
  console.log(JSON.stringify(verdict, null, 2))

  const passing = verdict.verdict === 'PASS' || verdict.verdict === 'PASS_WITH_WARNINGS'
  process.exit(passing ? 0 : 1)
}

main().catch(err => { console.error(err.message); process.exit(1) })
