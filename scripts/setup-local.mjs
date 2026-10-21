/** Prepare fresh-clone local debug signing without replacing existing credentials. */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ensureDebugSigning } from './gen-debug-signing.mjs'

const directory = fileURLToPath(new URL('../capsule/signing/', import.meta.url))
const properties = fileURLToPath(new URL('../capsule/signing/capsule.properties', import.meta.url))
const certificate = fileURLToPath(new URL('../capsule/signing/capsule.p12', import.meta.url))

if (!existsSync(properties)) {
  if (existsSync(certificate)) {
    throw new Error('Existing certificate has no properties. Restore its matching properties; no replacement was generated.')
  }
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const password = randomBytes(32).toString('hex')
  writeFileSync(properties, [
    '# Local debug signing only; do not publish or commit.',
    `storePassword=${password}`,
    'keyAlias=autocheck-local-debug',
    `keyPassword=${password}`,
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 })
  console.log('Created ignored local debug signing settings.')
}
if (!ensureDebugSigning()) process.exit(1)
