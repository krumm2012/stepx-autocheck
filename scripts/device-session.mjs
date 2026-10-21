/** USB-only development session in the user's existing debuggable STEPX shell.
 * Requires Node 22+, adb and unzip. Does not install, re-sign or publish an APK.
 * Private SDK copies / original preview URL stay in ignored .local/ only.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const LOCAL = path.join(ROOT, '.local', 'usb-session')
const STATE = path.join(LOCAL, 'session.json')
const PACKAGE = 'com.stepx.aiapp.p42bd7ce9ad0b'
const ACTIVITY = `${PACKAGE}/com.aiapp.container.WebContainerActivity`
const DEBUG_PORT = 9227
const DEV_PORT = 5175
const action = process.argv[2]
if (!['start', 'check', 'stop'].includes(action)) throw new Error('Usage: node scripts/device-session.mjs start|check|stop')
if (typeof WebSocket === 'undefined') throw new Error('USB debugging helper requires Node.js 22 or newer.')

const rawAdb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 12000, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const devices = rawAdb('devices').split('\n').slice(1).map(x => x.trim().split(/\s+/)).filter(x => x[1] === 'device')
const serial = process.env.ANDROID_SERIAL || (devices.length === 1 ? devices[0][0] : undefined)
if (!serial || !devices.some(x => x[0] === serial)) throw new Error('Connect one authorized USB device, or set ANDROID_SERIAL explicitly.')
const adb = (...args) => rawAdb('-s', serial, ...args)

async function connect() {
  const pages = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`, { signal: AbortSignal.timeout(5000) })).json()
  const page = pages.find(x => x.type === 'page')
  if (!page) throw new Error('The shell has no inspectable WebView page.')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error('WebView connection timed out; unlock and foreground the app.')) }, 6000)
    ws.addEventListener('open', () => { clearTimeout(timeout); resolve() }, { once: true })
    ws.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('Cannot connect to the WebView debugger.')) }, { once: true })
  })
  let seq = 0
  let pageLoaded = false
  const pending = new Map()
  ws.addEventListener('message', event => {
    const result = JSON.parse(event.data)
    if (result.method === 'Page.loadEventFired') pageLoaded = true
    const task = pending.get(result.id)
    if (!task) return
    pending.delete(result.id)
    clearTimeout(task.timer)
    result.error ? task.reject(new Error(`WebView debugger rejected ${task.method} (code ${result.error.code}).`)) : task.resolve(result.result)
  })
  return {
    call(method, params = {}) {
      const id = ++seq
      return new Promise((resolve, reject) => {
        // Native ability calls may wait for the user's one-time authorization.
        const timeoutMs = method === 'Runtime.evaluate' ? 65000 : 10000
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('WebView request timed out; unlock the phone and respond to any one-time ability prompt.')) }, timeoutMs)
        pending.set(id, { resolve, reject, timer, method })
        ws.send(JSON.stringify({ id, method, params }))
      })
    },
    async waitForLoad() {
      const deadline = Date.now() + 10000
      while (!pageLoaded && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100))
      if (!pageLoaded) throw new Error('Local document did not finish loading; recovery state was retained.')
    },
    close() {
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Session closed.')) }
      pending.clear()
      ws.close()
    },
  }
}

let session
try {
  if (action === 'start') {
    if (/\bshowing=true\b/.test(adb('shell', 'dumpsys', 'window', 'policy'))) throw new Error('Unlock the phone manually before starting a session.')
    const server = await fetch(`http://127.0.0.1:${DEV_PORT}/`, { signal: AbortSignal.timeout(3000) })
    if (!server.ok) throw new Error('Local Vite server is not ready on port 5175.')
    let state
    try { state = JSON.parse(await readFile(STATE, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
    if (state) throw new Error('A saved USB session exists. Run device:stop before starting again.')
    await mkdir(LOCAL, { recursive: true, mode: 0o700 })
    const apkPath = adb('shell', 'pm', 'path', PACKAGE).split('\n')[0].replace(/^package:/, '')
    if (!apkPath.startsWith('/')) throw new Error('STEPX test shell is not installed.')
    const apkFile = path.join(LOCAL, 'installed.apk')
    adb('pull', apkPath, apkFile)
    const manifest = JSON.parse(execFileSync('unzip', ['-p', apkFile, 'assets/ai-app/manifest.json'], { encoding: 'utf8' }))
    const original = new URL(manifest.debugUrl)
    if (original.protocol !== 'https:' || !['studio.stepx.com', 'studio-api.stepx.com'].includes(original.hostname) || !original.pathname.includes('p_42bd7ce9ad0bc85c')) {
      throw new Error('The installed shell does not identify this Builder preview. Stop before changing its page.')
    }
    const sdk = execFileSync('unzip', ['-p', apkFile, 'assets/sdk/capsule.js'], { encoding: 'utf8' })
    adb('shell', 'am', 'start', '-n', ACTIVITY)
    const pid = adb('shell', 'pidof', PACKAGE).split(/\s+/)[0]
    adb('forward', '--no-rebind', `tcp:${DEBUG_PORT}`, `localabstract:webview_devtools_remote_${pid}`)
    const existingReverse = adb('reverse', '--list')
    const createdReverse = !existingReverse.split('\n').some(line => line.includes(`tcp:${DEV_PORT} tcp:${DEV_PORT}`))
    if (createdReverse) adb('reverse', '--no-rebind', `tcp:${DEV_PORT}`, `tcp:${DEV_PORT}`)
    state = { serial, originalUrl: original.href, createdReverse, injectedScriptId: null }
    await writeFile(STATE, JSON.stringify(state), { mode: 0o600 })
    session = await connect()
    await session.call('Page.enable')
    const injected = await session.call('Page.addScriptToEvaluateOnNewDocument', { source: sdk })
    state.injectedScriptId = injected.identifier
    await writeFile(STATE, JSON.stringify(state), { mode: 0o600 })
    // A unique query guarantees a new document even when restarting from an
    // existing local session; a hash-only navigation would keep stale modules.
    const navigation = await session.call('Page.navigate', { url: `http://127.0.0.1:${DEV_PORT}/?usb-session=${Date.now()}#/settings` })
    if (navigation.errorText) throw new Error('The WebView could not load local Vite. Run device:stop to restore the preview.')
    await session.waitForLoad()
    console.log('USB local session started. Page and native actions now use local source; installed APK is unchanged.')
  } else {
    const state = JSON.parse(await readFile(STATE, 'utf8'))
    if (state.serial !== serial) throw new Error('Saved session belongs to another device.')
    adb('shell', 'am', 'start', '-n', ACTIVITY)
    session = await connect()
    if (action === 'check') {
      console.log('If the phone asks, authorize this single target-installation check on the phone.')
      const result = await session.call('Runtime.evaluate', {
        expression: `(async()=>{if(!window.mcp||!window.capsule)throw Error('bridge missing');await window.mcp.connect();const r=await window.mcp.callTool('check_app_installed_by_package',{packageName:'com.stepos.account'});return {localSource:location.origin==='http://127.0.0.1:${DEV_PORT}',pageReady:!!document.querySelector('#root')?.children.length,nativeMcp:!!window.AbilityMcp,installed:!r.isError&&typeof r.content==='string'&&r.content.includes('已安装')&&!r.content.includes('未安装')};})()`,
        awaitPromise: true, returnByValue: true,
      })
      const value = result.result?.value
      if (result.exceptionDetails || !value?.localSource || !value?.pageReady || !value?.nativeMcp || !value?.installed) throw new Error('USB smoke check failed: local page, native bridge or target installation is not ready.')
      console.log('PASS: local page rendered, native MCP connected, account target installed.')
    } else {
      if (state.injectedScriptId) {
        try { await session.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: state.injectedScriptId }) } catch { /* Shell process may have restarted. */ }
      }
      const result = await session.call('Page.navigate', { url: state.originalUrl })
      if (result.errorText) throw new Error('Could not restore the original preview; saved recovery state was retained.')
      if (state.createdReverse) adb('reverse', '--remove', `tcp:${DEV_PORT}`)
      adb('forward', '--remove', `tcp:${DEBUG_PORT}`)
      await rm(STATE)
      console.log('Original Builder preview restored. USB helper forwarding removed.')
    }
  }
} catch (error) {
  // Never print URLs, payloads, manifest contents, secrets or raw subprocess output.
  console.error(error instanceof Error && !error.stdout && !error.stderr ? error.message : 'Device command failed; check USB authorization and keep the phone unlocked.')
  process.exitCode = 1
} finally { session?.close() }
