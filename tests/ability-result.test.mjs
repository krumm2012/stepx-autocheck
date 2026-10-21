import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/shared/lib/ability-result.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
})
const { getInstalledStatus } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('actual device content response reports Amoo installed', () => {
  assert.equal(getInstalledStatus({ isError: false, content: 'Amoo已安装', structuredContent: null, errorCode: 0 }), true)
})
test('explicit not-installed response is false', () => {
  assert.equal(getInstalledStatus({ isError: false, content: '目标应用未安装' }), false)
})
test('legacy text responses remain supported', () => {
  assert.equal(getInstalledStatus({ text: 'Amoo已安装' }), true)
})
test('missing or ambiguous evidence is unknown, not not-installed', () => {
  for (const value of [{}, { content: '好的' }, { content: null }]) {
    assert.equal(getInstalledStatus(value), null)
  }
})
test('error response cannot claim installed even if it contains the wording', () => {
  assert.equal(getInstalledStatus({ isError: true, text: '已安装' }), null)
})
