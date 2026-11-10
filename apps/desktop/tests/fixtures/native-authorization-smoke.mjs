/** Real Electron consumer of the emitted native authorization carrier, using an in-memory HTTPS issuer. */
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, WebContentsView } from 'electron'

const [viewModule, userData, controllerModule, preload] = process.argv.slice(2)
if (viewModule === undefined || userData === undefined || controllerModule === undefined || preload === undefined) {
  throw new Error('Expected <built-view.js> <userData> <built-controller.js> <preload.cjs>')
}
app.setPath('userData', userData)
app.on('window-all-closed', () => {})
process.on('uncaughtException', error => { console.error('NATIVE_UNCAUGHT', error); app.exit(1) })
const requests = []
app.on('session-created', browserSession => {
  browserSession.protocol.handle('https', request => {
    requests.push(request.url)
    return new Response('<!doctype html><html><body><h1>Fixture QR issuer</h1><button>Continue</button></body></html>', { headers: { 'content-type': 'text/html' } })
  })
})
function guest(owner) {
  const child = owner.contentView.children.find(value => value.webContents !== undefined)
  if (child === undefined) throw new Error('Missing native authorization guest')
  return child.webContents
}
async function run() {
  await app.whenReady()
  const { DesktopAuthorizationView } = await import(pathToFileURL(viewModule).href)
  const owner = new BrowserWindow({ width: 600, height: 700, show: false, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true } })
  await owner.loadURL('data:text/html,<h1>Owned application</h1>')
  const manager = new DesktopAuthorizationView()
  const sender = { sender: owner.webContents, senderFrame: owner.webContents.mainFrame }
  const navigation = { authorizationUrl: 'https://issuer.native.test/login', callbackUrl: 'https://callback.native.test/complete?nonce=owned', allowedNavigationOrigins: ['https://issuer.native.test', 'https://callback.native.test'] }
  const bounds = { x: 24, y: 180, width: 552, height: 400 }
  let cancellations = 0
  await manager.open(owner, sender, navigation, bounds, async () => { throw new Error('Unexpected callback') }, () => { cancellations++ })
  const first = guest(owner)
  const browserSession = first.session
  assert.equal(browserSession.isPersistent(), false)
  assert.deepEqual(await first.executeJavaScript('({node: typeof process, require: typeof require, opener: window.opener === null})'), { node: 'undefined', require: 'undefined', opener: true })
  assert.equal(await first.executeJavaScript("window.open('https://untrusted.native.test') === null"), true)
  await first.executeJavaScript("localStorage.setItem('attempt', 'private'); document.cookie = 'attempt=private; Secure; SameSite=Strict'")
  assert.equal((await browserSession.cookies.get({})).length, 1)
  await manager.closeAndWait()
  assert.equal(first.isDestroyed(), true)
  assert.equal(cancellations, 1)
  assert.equal((await browserSession.cookies.get({})).length, 0)
  const probe = new WebContentsView({ webPreferences: { session: browserSession, sandbox: true, nodeIntegration: false } })
  await probe.webContents.loadURL(navigation.authorizationUrl)
  assert.equal(await probe.webContents.executeJavaScript("localStorage.getItem('attempt')"), null)
  probe.webContents.close({ waitForBeforeUnload: false })

  let delivered
  let completed
  const completion = new Promise(resolve => { completed = resolve })
  await manager.open(owner, sender, navigation, bounds, async url => { delivered = url; completed() }, () => { cancellations++ })
  const second = guest(owner)
  assert.notEqual(second.session, browserSession)
  await second.executeJavaScript("location.href = 'https://callback.native.test/complete?nonce=owned&code=synthetic'")
  await completion
  await manager.closeAndWait()
  assert.equal(delivered, 'https://callback.native.test/complete?nonce=owned&code=synthetic')
  assert.equal(requests.some(url => url.includes('callback.native.test')), false)
  assert.equal(cancellations, 1)

  await manager.open(owner, sender, navigation, bounds, async () => {}, () => { cancellations++ })
  const third = guest(owner)
  owner.destroy()
  await manager.dispose()
  assert.equal(third.isDestroyed(), true)
  assert.equal(cancellations, 2)
  process.stdout.write('NATIVE_AUTHORIZATION_RESULT sandboxed-node-free,memory-isolated,cancel-cleared,callback-private,owner-cleaned\n')

  const { NativeAuthorizationController } = await import(pathToFileURL(controllerModule).href)
  const expiryOwner = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, nodeIntegration: false, contextIsolation: true } })
  await expiryOwner.loadURL('data:text/html,<h1>Expiry renderer caller</h1>')
  const choices = [{ id: 'organization', label: 'Synthetic organization' }]
  let projection = { status: 'signed-out', choices }
  const provider = {
    getState: async () => projection,
    start: async () => {
      projection = { status: 'pending', choices, attempt: { id: 'expiry-attempt', expiresAt: 100 } }
      return { ...navigation, id: 'expiry-attempt', expiresAt: 100 }
    },
    complete: async () => projection,
    poll: async () => { projection = { status: 'signed-out', choices, error: 'expired' }; throw new Error('Synthetic attempt expired') },
    cancel: async () => { projection = { status: 'signed-out', choices }; return projection },
  }
  const controller = new NativeAuthorizationController(provider, async () => { throw new Error('Expired attempt admitted workspace') })
  controller.attach(expiryOwner)
  const created = new Promise(resolve => { app.once('web-contents-created', (_event, contents) => { resolve(contents) }) })
  await expiryOwner.webContents.executeJavaScript(`window.fixtureNative.start('organization', ${JSON.stringify(bounds)})`)
  const expiryGuest = await created
  if (expiryGuest.isLoading()) await new Promise(resolve => { expiryGuest.once('did-finish-load', resolve) })
  const expirySession = expiryGuest.session
  assert.equal(await expiryGuest.executeJavaScript('typeof window.fixtureNative'), 'undefined')
  await expiryGuest.executeJavaScript("localStorage.setItem('attempt', 'expired-private'); document.cookie = 'expired=private; Secure; SameSite=Strict'")
  assert.equal((await expirySession.cookies.get({})).length, 1)
  assert.equal(await expiryOwner.webContents.executeJavaScript("window.fixtureNative.poll('expiry-attempt').then(() => false, () => true)"), true)
  assert.equal(expiryGuest.isDestroyed(), false)
  const expired = await expiryOwner.webContents.executeJavaScript('window.fixtureNative.state()')
  assert.equal(expired.error, 'expired')
  assert.equal(expiryGuest.isDestroyed(), true)
  assert.equal((await expirySession.cookies.get({})).length, 0)
  const expiryProbe = new WebContentsView({ webPreferences: { session: expirySession, sandbox: true, nodeIntegration: false } })
  await expiryProbe.webContents.loadURL(navigation.authorizationUrl)
  assert.equal(await expiryProbe.webContents.executeJavaScript("localStorage.getItem('attempt')"), null)
  expiryProbe.webContents.close({ waitForBeforeUnload: false })
  await controller.dispose()
  expiryOwner.destroy()
  process.stdout.write('NATIVE_AUTHORIZATION_EXPIRY_RESULT guest-destroyed,cookies-cleared,storage-cleared\n')
  app.quit()
}
run().catch(error => { console.error(error); app.exit(1) })
