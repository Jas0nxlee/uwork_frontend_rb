/** Validate UWork preview identity and collect only checksummed unsigned installers. */
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const version = process.env.BUILD_VERSION ?? ''
const commit = process.env.GITHUB_SHA ?? ''
const product = JSON.parse(readFileSync('package.json', 'utf8')).version
const suffix = version.startsWith(`${product}.`) ? version.slice(product.length + 1) : ''
if (!/^\d{8}\.\d+$/.test(suffix)) throw Error('Preview version must extend the product version with YYYYMMDD.number')
if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('A full source commit is required')
if (process.env.GITHUB_REF !== 'refs/heads/master') throw Error('Preview publication requires master')
const output = '.artifacts/uwork-preview'
const targets = { 'mac-arm64': ['mac-arm64', 'dmg'], 'win-x64': ['win-x64', 'exe'] }

function filename(target) {
  const spec = targets[target]
  if (spec === undefined) throw Error('Unsupported preview target')
  return `uwork-next-${version}-${spec[0]}-unsigned.${spec[1]}`
}

function digest(path) {
  const data = readFileSync(path)
  return { size: data.length, sha256: createHash('sha256').update(data).digest('hex') }
}

switch (process.argv[2]) {
  case 'prepare':
    console.log(`Validated preview ${version} from ${commit}`)
    break
  case 'collect': {
    const target = process.env.PACKAGE_TARGET
    const name = filename(target)
    const source = join('apps/desktop/.desktop-build/targets', target, 'unsigned-artifacts', name)
    if (!statSync(source).isFile()) throw Error('Installer is not a regular file')
    const record = { version, commit, target, signed: false, name, ...digest(source) }
    if (record.size === 0) throw Error('Installer is empty')
    mkdirSync(output, { recursive: true })
    copyFileSync(source, join(output, name))
    writeFileSync(join(output, `${target}.json`), `${JSON.stringify(record, null, 2)}\n`)
    break
  }
  case 'verify': {
    const sums = []
    for (const target of Object.keys(targets)) {
      const record = JSON.parse(readFileSync(join(output, `${target}.json`), 'utf8'))
      const name = filename(target)
      const actual = digest(join(output, name))
      if (record.version !== version || record.commit !== commit || record.target !== target
        || record.signed !== false || record.name !== name || actual.size === 0
        || record.size !== actual.size || record.sha256 !== actual.sha256) {
        throw Error(`Installer identity or checksum mismatch for ${target}`)
      }
      sums.push(`${actual.sha256}  ${name}`)
    }
    writeFileSync(join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`)
    console.log('Verified Mac ARM and Windows x64 installers')
    break
  }
  default: throw Error('Expected prepare, collect or verify')
}
