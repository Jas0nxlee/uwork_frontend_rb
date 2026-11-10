/** Verified packages activate atomically and leave prior installations usable after failure. */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { Context } from '@deepseek-ai/cordis'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { CompanySkillProvider } from '../src/provider.ts'
import { CompanyInstallStore } from '../src/install-store.ts'
import CompanyMarket, { type Config } from '../src/index.ts'
import { contentFingerprint, extractPackage, portablePath } from '../src/archive.ts'

const zipFault = vi.hoisted(() => ({ abort: undefined as (() => void) | undefined }))
vi.mock('yauzl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('yauzl')>()
  return { ...actual, open: (path: string, options: import('yauzl').Options, callback: (error: Error | null, zip: import('yauzl').ZipFile) => void) => {
    actual.open(path, options, (error, zip) => {
      if (zipFault.abort !== undefined && zip !== undefined) {
        const original = zip.openReadStream.bind(zip)
        vi.spyOn(zip, 'openReadStream').mockImplementationOnce((entry, next) => {
          original(entry, (readError, stream) => { next(readError, stream); zipFault.abort?.(); zipFault.abort = undefined })
        })
      }
      callback(error, zip)
    })
  } }
})

const ioFault = vi.hoisted(() => ({ beforeFailure: undefined as (() => Promise<void>) | undefined, reads: 0, abort: undefined as (() => void) | undefined, path: '', mode: '' as '' | 'write' | 'growth' | 'readdir' | 'extra' | 'disappear' | 'abort-write' | 'cancel-read' }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const file = await actual.open(...args)
      if (String(args[0]) === ioFault.path && ioFault.mode === 'write') {
        ioFault.mode = ''
        vi.spyOn(file, 'writeFile').mockRejectedValueOnce(new Error('injected disk full'))
      }
      if (String(args[0]) === ioFault.path && ioFault.mode === 'abort-write') {
        const write = file.writeFile.bind(file)
        vi.spyOn(file, 'writeFile').mockImplementationOnce(async (...values) => {
          await write(...values)
          ioFault.abort?.()
        })
      }
      if (String(args[0]) === ioFault.path && ioFault.mode === 'growth') {
        ioFault.mode = ''
        vi.spyOn(file, 'readFile').mockResolvedValueOnce(Buffer.alloc(5 * 1024 * 1024))
      }
      return file
    },
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      const path = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : ''
      if (path.endsWith(join('skill', 'SKILL.md')) && ioFault.mode === 'disappear' && ++ioFault.reads > 1) {
        throw Object.assign(new Error('injected disappearance'), { code: 'ENOENT' })
      }
      return await actual.readFile(...args)
    },
    readdir: async (...args: Parameters<typeof actual.readdir>) => {
      if (String(args[0]) === ioFault.path && ioFault.mode === 'extra') {
        ioFault.mode = ''
        await actual.writeFile(join(ioFault.path, 'extra.md'), '---\nname: extra\ndescription: Unexpected skill\n---\nExtra instructions.')
      }
      if (String(args[0]) === ioFault.path && ioFault.mode === 'cancel-read') {
        await ioFault.beforeFailure?.()
        throw new Error('injected cancellation during directory read')
      }
      if (String(args[0]) === ioFault.path && ioFault.mode === 'readdir') throw new Error('injected directory read error')
      return await actual.readdir(...args)
    },
  }
})

const fault = vi.hoisted(() => ({ mode: 'none' as 'none' | 'before' | 'after' | 'unknown' | 'post-state', path: '', saved: '' }))
vi.mock('@deepseek-ai/dsh-atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return { ...actual, writeFileAtomic: async (...args: Parameters<typeof actual.writeFileAtomic>) => {
    if (args[0] !== fault.path || fault.mode === 'none') {  await actual.writeFileAtomic(...args); return }
    const mode = fault.mode
    fault.mode = 'none'
    if (mode === 'before') throw new Error('injected pre-commit write failure')
    await actual.writeFileAtomic(...args)
    if (mode === 'post-state') { ioFault.mode = 'growth'; return }
    if (mode === 'unknown') {
      fault.saved = await readFile(args[0], 'utf8')
      await writeFile(args[0], 'unreadable committed index')
    }
    throw new Error('injected lost write acknowledgement')
  } }
})

const source = 'https://market.example/skillhub'
const signal = () => new AbortController().signal
const limits = { maxArchiveEntries: 20, maxFileBytes: 4096, maxExpandedBytes: 8192, maxPathBytes: 512 }
const contents = { 'SKILL.md': '---\nname: weather\ndescription: Weather lookup\n---\nCheck the forecast.', 'scripts/run.py': 'print("weather")\n' }
function pack(files: Record<string, string> = contents) {
  const records = Object.entries(files).filter(([path]) => !path.endsWith('/')).map(([path, text]) => ({
    path, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'),
  }))
  return {
    bytes: zipSync(Object.fromEntries(Object.entries(files).map(([path, text]) => [path, strToU8(text)]))),
    fingerprint: contentFingerprint(records), records,
  }
}
async function temporary(beforeRemove?: () => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'uwork-market-install-'))
  onTestFinished(async () => { await beforeRemove?.(); await rm(root, { recursive: true, force: true }) })
  return root
}
async function mount(root: string, config: Partial<Config> = {}) {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(CompanyMarket, { baseUrl: source, installDir: root, ...config }).await()
  return ctx.get('uworkCompanyMarket')!
}
function server(pkg = pack(), changes: Record<string, unknown> = {}) {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (url.endsWith('clawhub.json')) return Response.json({ apiBase: '/skillhub/api/v1' })
    if (url.includes('/resolve?')) {
      const version = new URL(url).searchParams.get('version')
      return Response.json({ code: 0, data: { namespace: 'global', slug: 'weather', version, fingerprint: pkg.fingerprint,
        downloadUrl: `/api/v1/skills/global/weather/versions/${version}/download`, ...changes } })
    }
    return new Response(Uint8Array.from(pkg.bytes))
  })
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => { vi.unstubAllGlobals(); fault.mode = 'none'; ioFault.mode = ''; zipFault.abort = undefined })

describe('portable archive extraction', () => {
  it('verifies every file with the public compound fingerprint and preserves exact content', async () => {
    const root = await temporary(), pkg = pack()
    await writeFile(join(root, 'archive.zip'), pkg.bytes)
    await mkdir(join(root, 'out'))
    expect(await extractPackage(join(root, 'archive.zip'), join(root, 'out'), pkg.fingerprint, limits, signal())).toEqual(pkg.records)
    expect(await readFile(join(root, 'out/scripts/run.py'), 'utf8')).toBe(contents['scripts/run.py'])
  })
  it.each(['../escape', '/absolute', 'a//b', 'a/./b', 'a/../b', 'C:/file', 'a\\b', 'NUL.txt', 'a/COM1', 'a.', 'a ', 'a\u0000b'])('refuses unsafe portable path %j', (path) => {
    expect(() => portablePath(path, 512)).toThrow()
  })
  it.each([
    [{ 'SKILL.md': 'valid', 'skill.md': 'duplicate' }, 'duplicate'],
    [{ 'SKILL.md': 'valid', 'scripts': 'file', 'scripts/run.py': 'collision' }, 'duplicate'],
    [{ 'SKILL.md': 'valid', 'Scripts/a': 'a', 'scripts/b': 'b' }, 'duplicate'],
    [{ 'README.md': 'missing' }, 'missing-skill'],
    [{ 'SKILL.md': '' }, 'missing-skill'],
    [{ 'SKILL.md': 'valid', '../escape': 'unsafe' }, 'format'],
  ] as const)('rejects unsafe or incomplete archive %j', async (files, reason) => {
    const root = await temporary(), pkg = pack(files)
    await writeFile(join(root, 'archive.zip'), pkg.bytes)
    await mkdir(join(root, 'out'))
    await expect(extractPackage(join(root, 'archive.zip'), join(root, 'out'), pkg.fingerprint, limits, signal())).rejects.toMatchObject({ code: 'uwork-company-market/invalid-package', details: { reason } })
    await expect(readFile(join(root, 'escape'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each([{ maxArchiveEntries: 1 }, { maxFileBytes: 1 }, { maxExpandedBytes: 1 }, { maxPathBytes: 1 }])('enforces extraction limits %j', async (override) => {
    const root = await temporary(), pkg = pack()
    await writeFile(join(root, 'archive.zip'), pkg.bytes)
    await mkdir(join(root, 'out'))
    await expect(extractPackage(join(root, 'archive.zip'), join(root, 'out'), pkg.fingerprint, { ...limits, ...override }, signal())).rejects.toMatchObject({ code: 'uwork-company-market/invalid-package' })
  })
  it('rejects Unix links before creating link targets', async () => {
    const root = await temporary()
    const bytes = zipSync({ 'SKILL.md': strToU8('valid'), 'link': [strToU8('/outside'), { os: 3, attrs: 0o120777 << 16 }] })
    await writeFile(join(root, 'archive.zip'), bytes)
    await mkdir(join(root, 'out'))
    await expect(extractPackage(join(root, 'archive.zip'), join(root, 'out'), '', limits, signal())).rejects.toMatchObject({ code: 'uwork-company-market/invalid-package', details: { reason: 'symlink' } })
    await expect(readFile(join(root, 'out/link'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('rejects corrupt ZIPs and mismatched fingerprints', async () => {
    const root = await temporary(), pkg = pack()
    await mkdir(join(root, 'out'))
    await writeFile(join(root, 'archive.zip'), 'not a ZIP')
    await expect(extractPackage(join(root, 'archive.zip'), join(root, 'out'), '', limits, signal())).rejects.toMatchObject({ code: 'uwork-company-market/invalid-package' })
    await writeFile(join(root, 'archive.zip'), pkg.bytes)
    await expect(extractPackage(join(root, 'archive.zip'), join(root, 'out'), 'sha256:wrong', limits, signal())).rejects.toMatchObject({ code: 'uwork-company-market/invalid-package', details: { reason: 'fingerprint' } })
  })
})

describe('installation transactions', () => {
  it('installs, retries idempotently, updates and recovers across a fresh service', async () => {
    const root = await temporary(), market = await mount(root)
    server()
    expect(await market.installations(signal())).toEqual({ available: true, skills: [] })
    expect(await market.installSkill('weather', '1.0.0', signal())).toMatchObject({ slug: 'weather', version: '1.0.0', enabled: true, fileCount: 2 })
    const first = await readFile(join(root, 'index.json'), 'utf8')
    await market.installSkill('global--weather', '1.0.0', signal())
    expect(await readFile(join(root, 'index.json'), 'utf8')).toBe(first)
    server(pack({ ...contents, 'SKILL.md': contents['SKILL.md'] + '\nUpdated.' }))
    await market.installSkill('weather', '2.0.0', signal())
    expect((await readdir(join(root, 'versions'))).length).toBe(2)
    expect(await readdir(join(root, 'staging'))).toEqual([])
    const restarted = await mount(root)
    expect(await restarted.installations(signal())).toMatchObject({ available: true, skills: [{ version: '2.0.0' }] })
  })
  it.each([{ namespace: 'other' }, { slug: 'other' }, { version: 'different' }, { downloadUrl: 'https://evil.example/file' }, { fingerprint: 'sha256:' + '0'.repeat(64) }])('retains the prior version after rejected resolver/package %j', async (changes) => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    const before = await readFile(join(root, 'index.json'), 'utf8')
    server(pack(), changes)
    await expect(market.installSkill('weather', '2.0.0', signal())).rejects.toMatchObject({ code: 'uwork-company-market/invalid-package' })
    expect(await readFile(join(root, 'index.json'), 'utf8')).toBe(before)
    expect((await readdir(join(root, 'versions'))).length).toBe(1)
    expect(await readdir(join(root, 'staging'))).toEqual([])
  })
  it('bounds compressed downloads without changing installed state', async () => {
    const root = await temporary(), market = await mount(root, { maxArchiveBytes: 1 })
    server()
    await expect(market.installSkill('weather', '1.0.0', signal())).rejects.toMatchObject({ code: 'uwork-company-market/invalid-package', details: { reason: 'limit' } })
    expect(await market.installations(signal())).toMatchObject({ skills: [] })
    expect(await readdir(join(root, 'staging'))).toEqual([])
  })
  it('refuses corrupt durable state rather than treating it as an empty store', async () => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    await writeFile(join(root, 'index.json'), '{broken')
    await expect(market.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
    await expect(market.installSkill('weather', '2.0.0', signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
    expect((await readdir(join(root, 'versions'))).length).toBe(1)
  })
  it('serializes two services sharing a store without losing either committed history', async () => {
    const root = await temporary(), first = await mount(root), second = await mount(root)
    server()
    await Promise.all([first.installSkill('weather', '1.0.0', signal()), second.installSkill('weather', '2.0.0', signal())])
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as { entries: { versions: string[] }[] }
    expect(index.entries).toHaveLength(1)
    expect(index.entries[0]?.versions).toHaveLength(2)
  })
})


describe('native skill provider', () => {
  it('loads installed content, refreshes on enable changes and disposes its contribution', async () => {
    const root = await temporary(), ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SkillRegistry).await()
    const fiber = ctx.plugin(CompanyMarket, { baseUrl: source, installDir: root })
    await fiber.await()
    const market = ctx.get('uworkCompanyMarket')!, skills = ctx.get('skills')!
    server()
    expect(await skills.list()).toEqual([])
    await market.installSkill('weather', '1.0.0', signal())
    expect(await skills.list()).toMatchObject([{ name: 'weather', source: 'company-market' }])
    expect(await skills.get('weather')).toMatchObject({ name: 'weather', content: 'Check the forecast.', source: 'company-market' })
    await market.setEnabled('weather', false, signal())
    expect(await skills.list()).toEqual([])
    expect(await market.installations(signal())).toMatchObject({ skills: [{ enabled: false }] })
    await market.setEnabled('weather', true, signal())
    expect(await skills.list()).toHaveLength(1)
    await market.uninstallSkill('weather', signal())
    expect(await skills.list()).toEqual([])
    expect(await market.installations(signal())).toEqual({ available: true, skills: [] })
    expect(await readdir(join(root, 'versions'))).toEqual([])
    await market.installSkill('weather', '1.0.0', signal())
    await fiber.dispose()
    expect(await skills.list()).toEqual([])
  })
  it('preserves personal same-name skills through company management', async () => {
    const root = await temporary(), ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SkillRegistry).await()
    const skills = ctx.get('skills')!
    skills.register({ name: 'weather', description: 'Personal weather', content: 'Personal instructions', source: 'personal' })
    await ctx.plugin(CompanyMarket, { baseUrl: source, installDir: root }).await()
    const market = ctx.get('uworkCompanyMarket')!
    server()
    await market.installSkill('weather', '1.0.0', signal())
    expect(await skills.get('weather')).toMatchObject({ content: 'Personal instructions', source: 'personal' })
    await market.uninstallSkill('weather', signal())
    expect(await skills.get('weather')).toMatchObject({ content: 'Personal instructions', source: 'personal' })
  })
})


describe('activation acknowledgement failures', () => {
  it('removes an uncommitted candidate after an atomic write failure', async () => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    const before = await readFile(join(root, 'index.json'), 'utf8')
    fault.path = join(root, 'index.json'); fault.mode = 'before'
    await expect(market.installSkill('weather', '2.0.0', signal())).rejects.toMatchObject({ details: { outcome: 'unchanged' } })
    expect(await readFile(join(root, 'index.json'), 'utf8')).toBe(before)
    expect((await readdir(join(root, 'versions'))).length).toBe(1)
    expect(await readdir(join(root, 'staging'))).toEqual([])
  })
  it('recognizes a committed index when the writer loses its acknowledgement', async () => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installations(signal())
    fault.path = join(root, 'index.json'); fault.mode = 'after'
    expect(await market.installSkill('weather', '1.0.0', signal())).toMatchObject({ version: '1.0.0' })
    expect(await market.installations(signal())).toMatchObject({ skills: [{ version: '1.0.0' }] })
  })
  it('preserves both generations when the committed pointer cannot be read back', async () => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    fault.path = join(root, 'index.json'); fault.mode = 'unknown'
    await expect(market.installSkill('weather', '2.0.0', signal())).rejects.toMatchObject({ details: { outcome: 'unknown' } })
    expect((await readdir(join(root, 'versions'))).length).toBe(2)
    await expect(market.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
    await writeFile(join(root, 'index.json'), fault.saved)
    expect(await market.installations(signal())).toMatchObject({ skills: [{ version: '2.0.0' }] })
    expect((await readdir(join(root, 'versions'))).length).toBe(2)
  })
  it('cancels a stalled download, retains old state and releases the writer lock', async () => {
    const root = await temporary(), market = await mount(root)
    const fetcher = server()
    await market.installSkill('weather', '1.0.0', signal())
    const before = await readFile(join(root, 'index.json'), 'utf8')
    const ready = Promise.withResolvers<undefined>()
    const original = fetcher.getMockImplementation()!
    fetcher.mockImplementation(async (input, init) => {
      if ((typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith('/download')) {
        ready.resolve(undefined)
        return new Response(new ReadableStream({ start(controller) {
          init?.signal?.addEventListener('abort', () =>{  controller.error(new Error('download aborted')) }, { once: true })
        } }))
      }
      return await original(input, init)
    })
    const cancellation = new AbortController()
    const request = market.installSkill('weather', '2.0.0', cancellation.signal)
    const rejected = expect(request).rejects.toMatchObject({ details: { outcome: 'unchanged' } })
    await ready.promise
    cancellation.abort()
    await rejected
    expect(await readFile(join(root, 'index.json'), 'utf8')).toBe(before)
    expect(await readdir(join(root, 'staging'))).toEqual([])
    expect(await market.installations(signal())).toMatchObject({ skills: [{ version: '1.0.0' }] })
  })
})


interface DiskIndex {
  format: number
  source: string
  entries: { slug: string; current: string; versions: string[]; enabled: boolean }[]
}
interface DiskManifest {
  format: number
  source: string
  generation: string
  slug: string
  version: string
  fingerprint: string
  files: { path: string; sha256: string; bytes: number }[]
}
const corruptIndexes: [string, (index: DiskIndex) => void][] = [
  ['format', (index) => { index.format = 2 }],
  ['source', (index) => { index.source = 'https://other.example' }],
  ['unsafe identity', (index) => { index.entries[0]!.slug = '../outside' }],
  ['noncanonical global identity', (index) => { index.entries[0]!.slug = 'global--weather' }],
  ['duplicate identity', (index) => { index.entries.push({ ...index.entries[0]! }) }],
  ['missing current generation', (index) => { index.entries[0]!.current = randomUUID() }],
  ['duplicate generation', (index) => { index.entries[0]!.versions.push(index.entries[0]!.current) }],
  ['invalid generation', (index) => { index.entries[0]!.versions.push('outside') }],
]
const corruptManifests: [string, (manifest: DiskManifest) => void][] = [
  ['format', (manifest) => { manifest.format = 2 }],
  ['source', (manifest) => { manifest.source = 'https://other.example' }],
  ['generation', (manifest) => { manifest.generation = randomUUID() }],
  ['identity mismatch', (manifest) => { manifest.slug = 'other' }],
  ['unsafe path', (manifest) => { manifest.files[0]!.path = '../outside' }],
  ['duplicate path', (manifest) => { manifest.files.push({ ...manifest.files[0]! }) }],
  ['file budget', (manifest) => { manifest.files[0]!.bytes = 100 * 1024 * 1024 }],
  ['missing instruction', (manifest) => { manifest.files = [] }],
  ['fingerprint', (manifest) => { manifest.fingerprint = 'sha256:' + '0'.repeat(64) }],
]

describe('saved installation ownership and recovery', () => {
  it.each(corruptIndexes)('refuses a saved index with invalid %s', async (_label, corrupt) => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as DiskIndex
    corrupt(index)
    await writeFile(join(root, 'index.json'), JSON.stringify(index))
    await expect(market.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
    expect((await readdir(join(root, 'versions'))).length).toBe(1)
  })
  it.each(corruptManifests)('refuses a saved manifest with invalid %s', async (_label, corrupt) => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as DiskIndex
    const path = join(root, 'versions', index.entries[0]!.current, 'manifest.json')
    const manifest = JSON.parse(await readFile(path, 'utf8')) as DiskManifest
    corrupt(manifest)
    await writeFile(path, JSON.stringify(manifest))
    await expect(market.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
    expect((await readdir(join(root, 'versions'))).length).toBe(1)
  })
  it('refuses a missing authoritative index when committed versions already exist', async () => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    await rm(join(root, 'index.json'))
    await expect(market.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
    expect((await readdir(join(root, 'versions'))).length).toBe(1)
  })
  it('cleans abandoned owned staging but preserves unrelated names', async () => {
    const root = await temporary(), market = await mount(root)
    await market.installations(signal())
    const stage = join(root, 'staging', randomUUID())
    await mkdir(stage)
    await writeFile(join(stage, 'partial.zip'), 'incomplete')
    await mkdir(join(root, 'staging', 'unrelated'))
    await mkdir(join(root, 'staging', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'))
    await mkdir(join(root, 'versions', 'unrelated'))
    await market.installations(signal())
    expect((await readdir(join(root, 'staging'))).sort()).toEqual(['AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', 'unrelated'])
    expect(await readdir(join(root, 'versions'))).toEqual(['unrelated'])
  })
  it('retains idempotent installation at the version budget while refusing new versions', async () => {
    const root = await temporary(), market = await mount(root, { maxStoredVersions: 1, maxInstalledSkills: 1 })
    server()
    await market.installSkill('weather', '1.0.0', signal())
    expect(await market.installSkill('weather', '1.0.0', signal())).toMatchObject({ version: '1.0.0' })
    await expect(market.installSkill('weather', '2.0.0', signal())).rejects.toMatchObject({ details: { reason: 'limit' } })
    await expect(market.installSkill('another', '1.0.0', signal())).rejects.toMatchObject({ details: { reason: 'limit' } })
    expect(await readdir(join(root, 'staging'))).toEqual([])
    expect(await market.installations(signal())).toMatchObject({ skills: [{ version: '1.0.0' }] })
  })
  it('rejects a changed package at the same published version', async () => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    server(pack({ 'SKILL.md': contents['SKILL.md'] + 'Changed' }))
    await expect(market.installSkill('weather', '1.0.0', signal())).rejects.toMatchObject({ details: { reason: 'fingerprint' } })
    expect((await readdir(join(root, 'versions'))).length).toBe(1)
  })
  it.each(['before', 'after', 'unknown'] as const)('reconciles management after %s index acknowledgement failure', async (mode) => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    fault.path = join(root, 'index.json'); fault.mode = mode
    if (mode === 'after') {
      expect(await market.setEnabled('weather', false, signal())).toMatchObject({ skills: [{ enabled: false }] })
    } else {
      await expect(market.setEnabled('weather', false, signal())).rejects.toMatchObject({ details: { outcome: mode === 'before' ? 'unchanged' : 'unknown' } })
    }
    if (mode === 'unknown') await writeFile(join(root, 'index.json'), fault.saved)
    expect(await market.installations(signal())).toMatchObject({ skills: [{ enabled: mode === 'before' }] })
    await expect(market.uninstallSkill('missing', signal())).resolves.toMatchObject({ skills: [{ slug: 'weather' }] })
  })
})


it('serializes independent process writers through the owned file lock', async () => {
  const children: { child: ChildProcess; closed: Promise<void> }[] = []
  const root = await temporary(async () => {
      await Promise.all(children.map(async ({ child, closed }) => {
        if (child.exitCode === null && child.signalCode === null) child.kill()
        await closed
      }))
    }), pkg = pack()
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost')
    if (url.pathname.endsWith('clawhub.json')) { response.end(JSON.stringify({ apiBase: '/skillhub/api/v1' })); return }
    if (url.pathname.endsWith('/resolve')) {
      const version = url.searchParams.get('version')
      response.end(JSON.stringify({ code: 0, data: { namespace: 'global', slug: 'weather', version, fingerprint: pkg.fingerprint,
        downloadUrl: `/api/v1/skills/global/weather/versions/${version}/download` } })); return
    }
    response.end(pkg.bytes)
  })
  onTestFinished(async () => {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error) reject(error); else resolve() })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Missing fixture server address')
  const config = CompanyMarket.Config({ baseUrl: `http://127.0.0.1:${address.port}/skillhub`, installDir: root })
  const run = async (version: string) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', fileURLToPath(new URL('./fixtures/install-worker.ts', import.meta.url)),
      root, JSON.stringify(config), version], { stdio: ['ignore', 'pipe', 'pipe'] })
    const closed = new Promise<void>(resolve => child.once('close', () =>{  resolve() }))
    children.push({ child, closed })
    let stdout = '', stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
    const code = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve) })
    await closed
    expect({ code, stderr }).toEqual({ code: 0, stderr: '' })
    expect(JSON.parse(stdout)).toMatchObject({ slug: 'weather', version })
  }
  const attempts = await Promise.allSettled([run('1.0.0'), run('2.0.0')])
  for (const attempt of attempts) if (attempt.status === 'rejected') throw attempt.reason
  const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as DiskIndex
  expect(index.entries).toHaveLength(1)
  expect(index.entries[0]!.versions).toHaveLength(2)
  expect(await readdir(join(root, 'staging'))).toEqual([])
}, 40000)


describe('provider observations during installation changes', () => {
  async function setupProvider() {
    const root = await temporary(), ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const store = new CompanyInstallStore(root, CompanyMarket.Config({ baseUrl: source }), ctx)
    server()
    await store.install('weather', '1.0.0', signal())
    const control = new AbortController()
    onTestFinished(() =>{  control.abort() })
    const provider = new CompanySkillProvider(ctx, store, { signal: control.signal, invalidate: vi.fn() })
    const result = await provider.list({ signal: signal() })
    const entries = 'candidates' in result ? result.candidates : result
    const candidate = entries[0]
    if (candidate === undefined) throw new Error('Missing installed skill candidate')
    return { root, store, provider, candidate }
  }
  it('refuses a previously selected candidate after disable', async () => {
    const h = await setupProvider()
    await h.store.change('weather', false, signal())
    expect(await h.provider.get(h.candidate, { signal: signal() })).toBeUndefined()
  })
  it('reports a disappeared instruction as unavailable instead of loading stale content', async () => {
    const h = await setupProvider()
    const index = JSON.parse(await readFile(join(h.root, 'index.json'), 'utf8')) as DiskIndex
    await rm(join(h.root, 'versions', index.entries[0]!.current, 'skill', 'SKILL.md'))
    expect(await h.provider.get(h.candidate, { signal: signal() })).toBeUndefined()
  })
  it('rejects a package that the native parser cannot load', async () => {
    const root = await temporary(), ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(SkillRegistry).await()
    await ctx.plugin(CompanyMarket, { baseUrl: source, installDir: root }).await()
    server(pack({ 'SKILL.md': '---\ndescription: Native fallback naming\n---\nInstructions.' }))
    await expect(ctx.get('uworkCompanyMarket')!.installSkill('weather', '1.0.0', signal())).rejects.toMatchObject({ details: { reason: 'format' } })
    expect(await ctx.get('skills')!.get('weather')).toBeUndefined()
  })
})


function centralOffset(bytes: Uint8Array): number {
  const end = Buffer.from(bytes).lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  return Buffer.from(bytes).readUInt32LE(end + 16)
}
function duplicateEntry(bytes: Uint8Array, offset: number): Uint8Array {
  const data = Buffer.from(bytes), end = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const length = 46 + data.readUInt16LE(offset + 28) + data.readUInt16LE(offset + 30) + data.readUInt16LE(offset + 32)
  const tail = Buffer.from(data.subarray(end))
  tail.writeUInt16LE(tail.readUInt16LE(8) + 1, 8)
  tail.writeUInt16LE(tail.readUInt16LE(10) + 1, 10)
  tail.writeUInt32LE(tail.readUInt32LE(12) + length, 12)
  return Buffer.concat([data.subarray(0, end), data.subarray(offset, offset + length), tail])
}
async function extractFixture(bytes: Uint8Array, expected: string, root = '', cancellation = signal()) {
  const directory = root || await temporary()
  await writeFile(join(directory, 'archive.zip'), bytes)
  await mkdir(join(directory, 'out'))
  return await extractPackage(join(directory, 'archive.zip'), join(directory, 'out'), expected, limits, cancellation)
}

describe('ZIP metadata and resource failures', () => {
  it('accepts explicit directories and excludes them from the compound fingerprint', async () => {
    const pkg = pack({ 'SKILL.md': 'instructions', 'scripts/': '', 'scripts/run.py': 'print(1)' })
    expect(await extractFixture(pkg.bytes, pkg.fingerprint)).toEqual(pkg.records)
  })
  it.each(['encryption', 'wrong directory type', 'unsupported compression', 'corrupt central directory', 'corrupt compressed data'])(
    'rejects %s', async (mode) => {
      const pkg = pack(), bytes = Buffer.from(pkg.bytes), offset = centralOffset(bytes)
      if (mode === 'encryption') { bytes.writeUInt16LE(1, offset + 8); bytes.writeUInt16LE(1, 6) }
      if (mode === 'wrong directory type') bytes.writeUInt32LE((0o040755 << 16) >>> 0, offset + 38)
      if (mode === 'unsupported compression') { bytes.writeUInt16LE(99, offset + 10); bytes.writeUInt16LE(99, 8) }
      if (mode === 'corrupt central directory') bytes.writeUInt32LE(0, offset)
      if (mode === 'corrupt compressed data') bytes.fill(0xff, 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28), offset)
      await expect(extractFixture(bytes, pkg.fingerprint)).rejects.toMatchObject({ code: 'uwork-company-market/invalid-package', details: { reason: 'format' } })
    },
  )
  it.each(['SKILL.md', 'scripts/'])('rejects duplicate exact entries including %s', async (first) => {
    const pkg = pack({ [first]: 'content', 'SKILL.md': 'instructions' })
    await expect(extractFixture(duplicateEntry(pkg.bytes, centralOffset(pkg.bytes)), pkg.fingerprint)).rejects.toMatchObject({ details: { reason: 'duplicate' } })
  })
  it('contains disk-full failure while closing the owned output file', async () => {
    const root = await temporary(), pkg = pack()
    ioFault.path = join(root, 'out', 'SKILL.md'); ioFault.mode = 'write'
    await expect(extractFixture(pkg.bytes, pkg.fingerprint, root)).rejects.toMatchObject({ code: 'uwork-company-market/install-failed', details: { outcome: 'unchanged' } })
  })
  it('does not trust a manifest that grows beyond its byte budget after stat', async () => {
    const root = await temporary(), market = await mount(root)
    await market.installations(signal())
    ioFault.path = join(root, 'index.json'); ioFault.mode = 'growth'
    await expect(market.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
  })
  it('reports an incomplete provider observation for a failed native root read', async () => {
    const root = await temporary(), ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    const store = new CompanyInstallStore(root, CompanyMarket.Config({ baseUrl: source }), ctx)
    server()
    await store.install('weather', '1.0.0', signal())
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as DiskIndex
    const control = new AbortController()
    onTestFinished(() =>{  control.abort() })
    const provider = new CompanySkillProvider(ctx, store, { signal: control.signal, invalidate: vi.fn() })
    ioFault.path = join(root, 'versions', index.entries[0]!.current); ioFault.mode = 'readdir'
    expect(await provider.list({})).toMatchObject({ complete: false })
    ioFault.mode = ''
    expect(await provider.list({})).toMatchObject([{ name: 'weather' }])
  })
})

describe('resolver and download admission', () => {
  it.each(['../escape', 'team--', '--weather'])('rejects invalid selected identity %j', async (slug) => {
    const root = await temporary(), market = await mount(root), fetcher = server()
    await expect(market.installSkill(slug, '1.0.0', signal())).rejects.toMatchObject({ details: { reason: 'identity' } })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['', '../version', 'one/two'])('rejects invalid selected version %j', async (version) => {
    const root = await temporary(), market = await mount(root), fetcher = server()
    await expect(market.installSkill('weather', version, signal())).rejects.toMatchObject({ details: { reason: 'version' } })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    { fingerprint: 'invalid' }, { namespace: null }, { downloadUrl: '//evil.example/download' },
    { downloadUrl: 'relative/file' }, { downloadUrl: 'http://[invalid' }, { downloadUrl: '/other' },
  ])('rejects malformed or unbound resolver data %j', async (changes) => {
    const root = await temporary(), market = await mount(root)
    server(pack(), changes)
    await expect(market.installSkill('weather', '1.0.0', signal())).rejects.toMatchObject({ details: { reason: 'identity' } })
    expect(await readdir(join(root, 'staging'))).toEqual([])
  })
  it.each([
    '/skillhub/api/v1/skills/global/weather/versions/1.0.0/download',
    source + '/api/v1/skills/global/weather/versions/1.0.0/download',
  ])('accepts the bound download route %s', async (downloadUrl) => {
    const root = await temporary(), market = await mount(root)
    server(pack(), { downloadUrl })
    expect(await market.installSkill('weather', '1.0.0', signal())).toMatchObject({ version: '1.0.0' })
  })
  it('rejects a download without a body before activating content', async () => {
    const root = await temporary(), market = await mount(root), fetcher = server()
    const original = fetcher.getMockImplementation()!
    fetcher.mockImplementation(async (input, init) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith('/download') ? new Response(null) : await original(input, init))
    await expect(market.installSkill('weather', '1.0.0', signal())).rejects.toMatchObject({ details: { reason: 'format' } })
  })
  it('contains a failing response cancellation while reporting the original compressed-byte limit', async () => {
    const root = await temporary(), market = await mount(root, { maxArchiveBytes: 1 }), fetcher = server()
    const original = fetcher.getMockImplementation()!
    const cancel = vi.fn(async () => { throw new Error('injected cancellation failure') })
    fetcher.mockImplementation(async (input, init) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith('/download') ? new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2)) }, cancel,
    })) : await original(input, init))
    await expect(market.installSkill('weather', '1.0.0', signal())).rejects.toMatchObject({ details: { reason: 'limit' } })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(await readdir(join(root, 'staging'))).toEqual([])
  })
})


it('rejects unsafe ZIP64 sizes before opening the entry stream', async () => {
  const large = Buffer.alloc(8)
  large.writeBigUInt64LE(9007199254740992n)
  const bytes = Buffer.from(zipSync({ 'SKILL.md': [strToU8('instructions'), { extra: { 1: large } }] }))
  bytes.writeUInt32LE(0xffffffff, centralOffset(bytes) + 24)
  await expect(extractFixture(bytes, '')).rejects.toMatchObject({ details: { reason: 'format' } })
})

it('keeps file hash ordering consistent with Unicode code points', () => {
  const files = ['\u{10000}.md', '\ue000.md'].map(path => ({ path, bytes: 1, sha256: '0'.repeat(64) }))
  const expected = createHash('sha256').update(`\ue000.md:${'0'.repeat(64)}\n\u{10000}.md:${'0'.repeat(64)}\n`).digest('hex')
  expect(contentFingerprint(files)).toBe('sha256:' + expected)
})


it('aborts an active extraction and settles its file and ZIP resources', async () => {
  const root = await temporary(), pkg = pack(), cancellation = new AbortController()
  ioFault.path = join(root, 'out', 'SKILL.md'); ioFault.mode = 'abort-write'
  ioFault.abort = () =>{  cancellation.abort(new Error('cancelled during extraction')) }
  await expect(extractFixture(pkg.bytes, pkg.fingerprint, root, cancellation.signal)).rejects.toThrow('cancelled during extraction')
})

it.each(['readdir', 'extra'] as const)('refuses activation when native validation encounters %s', async (mode) => {
  const root = await temporary(), market = await mount(root), fetcher = server()
  const original = fetcher.getMockImplementation()!
  fetcher.mockImplementation(async (input, init) => {
    const response = await original(input, init)
    if ((typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).endsWith('/download')) {
      const [stage] = await readdir(join(root, 'staging'))
      if (stage === undefined) throw new Error('Missing staged download')
      ioFault.path = join(root, 'staging', stage, 'version'); ioFault.mode = mode
    }
    return response
  })
  await expect(market.installSkill('weather', '1.0.0', signal())).rejects.toMatchObject({ details: { reason: 'format' } })
})

it.each(['disappear', 'empty-body'] as const)('refuses activation when the instruction is %s after discovery', async (mode) => {
  const root = await temporary(), market = await mount(root)
  server(mode === 'empty-body' ? pack({ 'SKILL.md': '---\nname: weather\ndescription: Weather\n---\n' }) : pack())
  if (mode === 'disappear') { ioFault.mode = 'disappear'; ioFault.reads = 0 }
  await expect(market.installSkill('weather', '1.0.0', signal())).rejects.toMatchObject({ details: { reason: 'format' } })
})


describe('storage boundaries', () => {
  it('keeps catalog-only profiles readable and refuses installation writes', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await ctx.plugin(CompanyMarket, { baseUrl: source }).await()
    const market = ctx.get('uworkCompanyMarket')!
    expect(await market.installations(signal())).toEqual({ available: false, skills: [] })
    await expect(market.installSkill('weather', '1', signal())).rejects.toMatchObject({ code: 'uwork-company-market/storage-unavailable' })
    await expect(market.setEnabled('weather', true, signal())).rejects.toMatchObject({ code: 'uwork-company-market/storage-unavailable' })
  })
  it('uses the launched profile directory as its default installation owner', async () => {
    const root = await temporary(), ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    ctx.provide('profileContext', { name: 'test', dir: root, patchPath: join(root, 'cordis.patch.yml'), installAnchor: join(root, 'package.json'),
      cwd: root, home: root, startedBundles: [], overlays: [], telemetryDisabledEnv: undefined })
    await ctx.plugin(CompanyMarket, { baseUrl: source }).await()
    expect(await ctx.get('uworkCompanyMarket')!.installations(signal())).toEqual({ available: true, skills: [] })
    expect(await readFile(join(root, 'company-skills', 'index.json'), 'utf8')).toContain(source)
  })
  it('rejects relative installation configuration at mount', async () => {
    const ctx = new Context()
    onTestFinished(() => ctx.fiber.dispose())
    await expect(ctx.plugin(CompanyMarket, { baseUrl: source, installDir: './relative' }).await()).rejects.toThrow('must be absolute')
  })
  it('classifies a failed state read without exposing raw filesystem diagnostics', async () => {
    const root = await temporary(), market = await mount(root)
    await market.installations(signal())
    ioFault.path = join(root, 'versions'); ioFault.mode = 'readdir'
    await expect(market.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
  })
  it.each(['generation', 'content', 'index'] as const)('refuses a %s directory/file substitution', async (kind) => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as DiskIndex
    const path = kind === 'index' ? join(root, 'index.json') : join(root, 'versions', index.entries[0]!.current, ...kind === 'content' ? ['skill'] : [])
    await rm(path, { recursive: true })
    if (kind === 'index') await mkdir(path)
    else await writeFile(path, 'unexpected regular file')
    await expect(market.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
  })
  it.skipIf(process.platform === 'win32')('refuses a linked store directory without modifying its target', async () => {
    const parent = await temporary(), root = join(parent, 'store'), target = join(parent, 'target'), market = await mount(root)
    await market.installations(signal())
    await rename(root, target)
    const before = await readFile(join(target, 'index.json'), 'utf8')
    await symlink(target, root, 'dir')
    await expect(market.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
    expect(await readFile(join(target, 'index.json'), 'utf8')).toBe(before)
  })
  it.each(['global--weather', '../outside'])('refuses an orphan with invalid saved identity %s', async (slug) => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as DiskIndex
    const id = randomUUID(), orphan = join(root, 'versions', id)
    await cp(join(root, 'versions', index.entries[0]!.current), orphan, { recursive: true })
    const manifest = JSON.parse(await readFile(join(orphan, 'manifest.json'), 'utf8')) as DiskManifest
    await writeFile(join(orphan, 'manifest.json'), JSON.stringify({ ...manifest, generation: id, slug }))
    await expect(market.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
    expect((await readdir(join(root, 'versions'))).length).toBe(2)
  })
  it.each(['skills', 'versions'] as const)('refuses saved state above the configured %s budget', async (kind) => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    await market.installSkill('weather', '2.0.0', signal())
    if (kind === 'skills') {
      const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as DiskIndex
      const id = randomUUID()
      index.entries.push({ slug: 'another', current: id, versions: [id], enabled: true })
      await writeFile(join(root, 'index.json'), JSON.stringify(index))
    }
    const limited = await mount(root, kind === 'skills' ? { maxInstalledSkills: 1 } : { maxStoredVersions: 1 })
    await expect(limited.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
  })
  it('rejects oversized index files and bounds its initial encoded index', async () => {
    const root = await temporary(), market = await mount(root, { maxManifestBytes: 1024 })
    await market.installations(signal())
    await writeFile(join(root, 'index.json'), ' '.repeat(1025))
    await expect(market.installations(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
    const empty = await mount(await temporary(), { maxManifestBytes: 1 })
    await expect(empty.installations(signal())).rejects.toMatchObject({ details: { reason: 'limit' } })
  })
  it('preserves a committed management change when its follow-up summary cannot be read', async () => {
    const root = await temporary(), market = await mount(root)
    server()
    await market.installSkill('weather', '1.0.0', signal())
    const index = JSON.parse(await readFile(join(root, 'index.json'), 'utf8')) as DiskIndex
    ioFault.path = join(root, 'versions', index.entries[0]!.current, 'manifest.json')
    fault.path = join(root, 'index.json'); fault.mode = 'post-state'
    await expect(market.setEnabled('weather', false, signal())).rejects.toMatchObject({ details: { outcome: 'committed' } })
    expect(await market.installations(signal())).toMatchObject({ skills: [{ enabled: false }] })
    await writeFile(join(root, 'index.json'), 'invalid')
    await expect(market.setEnabled('weather', true, signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
  })
  it('installs a named namespace using its canonical identity', async () => {
    const root = await temporary(), market = await mount(root)
    server(pack(), { namespace: 'company', downloadUrl: '/api/v1/skills/company/weather/versions/1.0.0/download' })
    expect(await market.installSkill('company--weather', '1.0.0', signal())).toMatchObject({ slug: 'company--weather' })
  })
})


it('contains cancellation admitted immediately after a ZIP entry stream opens', async () => {
  const root = await temporary(), pkg = pack(), cancellation = new AbortController()
  zipFault.abort = () =>{  cancellation.abort(new Error('cancelled after ZIP entry opened')) }
  await expect(extractFixture(pkg.bytes, pkg.fingerprint, root, cancellation.signal)).rejects.toThrow('cancelled after ZIP entry opened')
})

it.each(['caller', 'dispose'] as const)('cancels an installation list read on %s and awaits cleanup', async (mode) => {
  const root = await temporary(), ctx = new Context(), cancellation = new AbortController()
  onTestFinished(() => ctx.fiber.dispose())
  await ctx.plugin(CompanyMarket, { baseUrl: source, installDir: root }).await()
  const market = ctx.get('uworkCompanyMarket')!
  await market.installations(signal())
  let disposal: Promise<void> | undefined
  ioFault.path = join(root, 'versions'); ioFault.mode = 'cancel-read'
  ioFault.beforeFailure = async () => {
    if (mode === 'caller') cancellation.abort(new Error('caller cancelled'))
    else disposal = ctx.fiber.dispose()
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  await expect(market.installations(cancellation.signal)).rejects.toThrow()
  await disposal
})


it.skipIf(process.platform === 'win32')('preserves owner execute permission while stripping group, other and special permission bits', async () => {
  const root = await temporary(), files = { 'SKILL.md': 'instructions', 'run.sh': '#!/bin/sh\nexit 0\n' }
  const pkg = pack(files)
  const bytes = zipSync({ 'SKILL.md': strToU8(files['SKILL.md']), 'run.sh': [strToU8(files['run.sh']), { os: 3, attrs: (0o104777 << 16) >>> 0 }] })
  await extractFixture(bytes, pkg.fingerprint, root)
  expect((await stat(join(root, 'out/run.sh'))).mode & 0o7777).toBe(0o700)
  expect((await stat(join(root, 'out/SKILL.md'))).mode & 0o7777).toBe(0o600)
})

it('accepts URI-equivalent exact build versions and fetches only the known bound endpoint', async () => {
  const root = await temporary(), market = await mount(root)
  const fetcher = server(pack(), { downloadUrl: '/api/v1/skills/global/weather/versions/1.0.0+build/download' })
  expect(await market.installSkill('weather', '1.0.0+build', signal())).toMatchObject({ version: '1.0.0+build' })
  expect(fetcher).toHaveBeenLastCalledWith(source + '/api/v1/skills/global/weather/versions/1.0.0%2Bbuild/download', expect.any(Object))
})

it.each([
  'https://user@market.example/skillhub/api/v1/skills/global/weather/versions/1.0.0/download',
  'https://:password@market.example/skillhub/api/v1/skills/global/weather/versions/1.0.0/download',
  source + '/api/v1/skills/global/weather/versions/1.0.0/download?extra=1',
  source + '/api/v1/skills/global/weather/versions/1.0.0/download#fragment',
  source + '/api/v1/skills/global/weather/versions/%ZZ/download',
  source + '/api/v1/skills/global/weather/versions/1.0.0%2Fdownload',
])('refuses a declared download with extra or malformed URL components %s', async (downloadUrl) => {
  const root = await temporary(), market = await mount(root)
  server(pack(), { downloadUrl })
  await expect(market.installSkill('weather', '1.0.0', signal())).rejects.toMatchObject({ details: { reason: 'identity' } })
})


it('keeps the old skill readable while an update downloads and switches only after activation', async () => {
  const ctx = new Context(), root = await temporary(() => ctx.fiber.dispose())
  await ctx.plugin(SkillRegistry).await()
  await ctx.plugin(CompanyMarket, { baseUrl: source, installDir: root }).await()
  const market = ctx.get('uworkCompanyMarket')!, skills = ctx.get('skills')!
  server()
  await market.installSkill('weather', '1.0.0', signal())
  const old = await skills.get('weather')
  expect(old?.content).toBe('Check the forecast.')
  const updated = pack({ ...contents, 'SKILL.md': contents['SKILL.md'] + '\nUpdated instructions.' })
  const fetcher = server(updated), original = fetcher.getMockImplementation()!
  const downloading = Promise.withResolvers<undefined>(), release = Promise.withResolvers<undefined>()
  fetcher.mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/download')) {
      downloading.resolve(undefined)
      const abort = () => {
        release.reject(new Error('update aborted'))
      }
      init?.signal?.addEventListener('abort', abort, { once: true })
      try { await release.promise } finally { init?.signal?.removeEventListener('abort', abort) }
    }
    return await original(input, init)
  })
  const update = market.installSkill('weather', '2.0.0', signal())
  await Promise.race([downloading.promise, update])
  try {
    expect((await skills.get('weather', { signal: AbortSignal.timeout(10000) }))?.content).toBe('Check the forecast.')
  } finally { release.resolve(undefined); await update }
  expect((await skills.get('weather'))?.content).toContain('Updated instructions.')
  if (old?.path === undefined) throw new Error('Loaded company skill has no resource path')
  expect(await readFile(old.path, 'utf8')).toBe(contents['SKILL.md'])
})

it('refuses corrupt activation state during a lock-free provider lookup', async () => {
  const root = await temporary(), ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const store = new CompanyInstallStore(root, CompanyMarket.Config({ baseUrl: source }), ctx)
  await store.list(signal())
  await writeFile(join(root, 'index.json'), 'invalid')
  await expect(store.enabledRoots(signal())).rejects.toMatchObject({ code: 'uwork-company-market/state-invalid' })
})
