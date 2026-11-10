/** Opt-in real WeCom empty-flow probe. No callback authentication or policy overrides. */
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow } from 'electron'
const [modulePath, descriptor, userData, evidence] = process.argv.slice(2)
app.setPath('userData', userData)
// Use the managed environment's outbound proxy without weakening certificate checks.
if (process.env.HTTPS_PROXY) app.commandLine.appendSwitch('proxy-server', process.env.HTTPS_PROXY)
app.on('window-all-closed', () => {})
async function run() {
  await app.whenReady()
  const { DesktopAuthorizationView, AuthorizationNavigationPolicy } = await import(pathToFileURL(modulePath).href)
  const navigation = JSON.parse(await readFile(descriptor, 'utf8'))
  const policy = new AuthorizationNavigationPolicy(navigation)
  const owner = new BrowserWindow({ width: 720, height: 820, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
  await owner.loadURL('data:text/html,<h1>WeCom live empty-flow verification</h1>')
  const manager = new DesktopAuthorizationView()
  try {
    await manager.open(owner, { sender: owner.webContents, senderFrame: owner.webContents.mainFrame }, navigation,
      { x: 0, y: 70, width: 720, height: 710 }, async () => { throw new Error('Unexpected real authentication callback') }, () => {})
    const guest = owner.contentView.children.find(value => value.webContents !== undefined).webContents
    const browserSession = guest.session
    assert.equal(browserSession.isPersistent(), false)
    assert.equal(policy.allows(guest.getURL()), true)
    assert.equal(await guest.executeJavaScript('typeof process'), 'undefined')
    // Let the public issuer finish its asynchronous QR/resource bootstrap without interacting.
    await new Promise(resolve => setTimeout(resolve, 8000))
    const safe = await guest.executeJavaScript(`(() => ({title:document.title,text:document.body.innerText.slice(0,2000),images:[...document.images].map(i=>({loaded:i.complete&&i.naturalWidth>0,width:i.naturalWidth,height:i.naturalHeight})),frames:document.querySelectorAll('iframe').length,canvas:document.querySelectorAll('canvas').length}))()`)
    await mkdir(evidence, { recursive: true })
    await writeFile(`${evidence}/wecom.png`, (await guest.capturePage()).toPNG())
    await writeFile(`${evidence}/safe-page.json`, JSON.stringify(safe, null, 2))
    assert.ok(safe.images.some(image => image.loaded && image.width >= 100) || safe.canvas > 0 || safe.frames > 0, 'No QR/image/frame resource visible; inspect safe evidence')
    await manager.closeAndWait()
    assert.equal(guest.isDestroyed(), true)
    assert.equal((await browserSession.cookies.get({})).length, 0)
    console.log('WECOM_LIVE_RESULT real-page-loaded,resources-visible,legal-navigation,cancel-destroyed,cookies-cleared')
  } finally { await manager.dispose(); owner.destroy() }
  app.quit()
}
run().catch(error => { console.error(error.message); app.exit(1) })
