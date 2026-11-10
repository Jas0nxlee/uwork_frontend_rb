/** Reject maintained references to repository commits and the disallowed organization URL. */

import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canonicalReferenceText } from './verify-public-repository-links.ts'

const root = resolve(import.meta.dirname, '..')
const organization = ['deepseek', 'harness'].join('-')
const organizationUrl = new RegExp(`\\bgithub\\.com/${organization}(?![a-z0-9-])`)
// The independent kit repository owns the engine source and documentation.
const kitRepositoryUrl = new RegExp(`\\bgithub\\.com/${organization}/libreoffice-kit(?:\\.git)?(?=/|[^a-zA-Z0-9_.-]|$)`, 'g')
// Decimal-only tokens collide with sizes, counts, and version components; see docs/AGENTS.md#repository-references.
const commitCandidate = /(?<![a-z0-9])(?=[\da-f]{0,39}[a-f])[\da-f]{7,40}(?![a-z0-9])/gi
const excludedPrefixes = ['vendor/', '.agents/notes/archived/']
const gitOutputLimit = 64 * 1024 * 1024
// One 41-byte line per object; 1.2 million objects produce about 49 MiB.
const objectListingLimit = 1024 * 1024 * 1024

/** One prohibited reference in a maintained source file. */
export interface RepositoryReference {
  /** Repository-relative path, with forward slashes. */
  file: string
  /** One-based source line containing the reference. */
  line: number
  /** Whether the line names a repository commit or the disallowed organization URL. */
  kind: 'commit-hash' | 'organization-url'
}

function isMaintained(file: string): boolean {
  return !excludedPrefixes.some(prefix => file.startsWith(prefix))
}

/** The one fixed-baseline audit artifact records object identities rather than maintained source links. */
const upstreamAuditPath = 'tasks/fixtures/upstream-maintenance.json'

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function auditRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Admit only the bounded, successful read-command transcript used for the fixed T40 baseline. */
function isUpstreamAudit(file: string, source: string): boolean {
  if (file !== upstreamAuditPath || source.length > 8192) return false
  let value: unknown
  try {
    value = JSON.parse(source)
    // Canonical readable JSON rejects duplicate-key prose hidden by JSON.parse's last-key-wins behavior.
    if (JSON.stringify(value, null, 2) !== source.replace(/\r\n/g, '\n').trimEnd()) return false
  } catch { return false }
  if (!auditRecord(value) || !exactKeys(value, ['kind', 'version', 'observedAt', 'upstream', 'head', 'mergeBase',
    'snapshotTree', 'snapshotCommit', 'scopes', 'mergeTreeExitCode', 'mergeTreeStdout', 'mergeTreeStderr',
    'changedFiles', 'note', 'commands'])) return false
  if (value.kind !== 'uwork-upstream-compatibility-audit' || (value.version !== 1 && value.version !== 2)
    || typeof value.observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+(?:Z|\+00:00)$/u.test(value.observedAt)
    || !Number.isFinite(Date.parse(value.observedAt))) return false
  for (const key of ['upstream', 'head', 'mergeBase', 'snapshotTree', 'snapshotCommit']) {
    if (typeof value[key] !== 'string' || !/^[a-f0-9]{40}$/u.test(value[key])) return false
  }
  if (value.mergeBase !== value.upstream || value.mergeTreeExitCode !== 0 || value.mergeTreeStdout !== value.snapshotTree
    || value.mergeTreeStderr !== '' || !Number.isSafeInteger(value.changedFiles)
    || typeof value.changedFiles !== 'number' || value.changedFiles < 1 || value.changedFiles > 100000) return false
  const scopes = value.version === 1
    ? ['apps/desktop', 'apps/desktop-host', 'packages/client/ui-sidebar', 'packages/llm/llm-pi-ai']
    : ['apps/desktop', 'apps/desktop-host', 'packages/client/ui-attachment', 'packages/client/ui-chat',
      'packages/client/ui-conversation', 'packages/client/ui-dockkit', 'packages/client/ui-primitives',
      'packages/client/ui-sidebar', 'packages/client/ui-sidebar-right', 'packages/client/ui-tool',
      'packages/core/agent-default-model', 'packages/llm/llm-pi-ai']
  const note = value.version === 1
    ? 'Temporary index and unreferenced snapshot commit only; no ref, actual index, worktree or branch changed.'
    : 'Committed reachable source snapshot only; no ref, actual index, worktree or branch changed.'
  if (value.note !== note || JSON.stringify(value.scopes) !== JSON.stringify(scopes)
    || (value.version === 2 && value.snapshotCommit !== value.head)) return false
  const expected = [
    { argv: ['git', 'ls-remote', 'origin', 'refs/heads/master'], exitCode: 0,
      stdout: `${String(value.upstream)}\trefs/heads/master`, stderr: '' },
    { argv: ['git', 'merge-tree', '--write-tree', value.upstream, value.snapshotCommit], exitCode: 0,
      stdout: value.snapshotTree, stderr: '' },
  ]
  if (!Array.isArray(value.commands) || value.commands.length !== expected.length) return false
  return value.commands.every((command: unknown, index: number) => auditRecord(command)
    && exactKeys(command, ['argv', 'exitCode', 'stdout', 'stderr'])
    && JSON.stringify(command.argv) === JSON.stringify(expected[index]?.argv)
    && command.exitCode === 0 && command.stderr === '' && command.stdout === expected[index]?.stdout)
}

/**
 * Inspect a maintained source file against known commit identifiers.
 * @param file - Repository-relative path used in diagnostics and exclusions.
 * @param source - File text or a symlink's stored target.
 * @param commits - Lowercase, unambiguous full or abbreviated commit identifiers.
 * @returns One finding per line and reference kind; digests and other Git object types are accepted.
 * Decimal-only tokens are ignored, including actual commit identifiers.
 */
export function findRepositoryReferences(
  file: string,
  source: string,
  commits: ReadonlySet<string>,
): RepositoryReference[] {
  if (!isMaintained(file) || isUpstreamAudit(file, source)) return []
  const references: RepositoryReference[] = []
  for (const [index, line] of source.split('\n').entries()) {
    if (organizationUrl.test(canonicalReferenceText(line).replace(kitRepositoryUrl, ''))) {
      references.push({ file, line: index + 1, kind: 'organization-url' })
    }
    if ([...line.matchAll(commitCandidate)].some(match => commits.has(match[0].toLowerCase()))) {
      references.push({ file, line: index + 1, kind: 'commit-hash' })
    }
  }
  return references
}

function readMaintainedFiles(repoRoot: string): Map<string, string> {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: gitOutputLimit,
  }).split('\0').filter(file => file !== '' && isMaintained(file))
  const sources = new Map<string, string>()
  for (const file of files) {
    const path = resolve(repoRoot, file)
    const stat = lstatSync(path, { throwIfNoEntry: false })
    if (stat?.isSymbolicLink() === true) sources.set(file, readlinkSync(path))
    else if (stat?.isFile() === true) sources.set(file, readFileSync(path, 'utf8'))
  }
  return sources
}

function gitLines(repoRoot: string, args: readonly string[], maxBuffer: number, input?: string): string[] {
  const output = execFileSync('git', args, {
    cwd: repoRoot,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1' },
    encoding: 'utf8',
    input,
    maxBuffer,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trimEnd()
  return output === '' ? [] : output.split('\n')
}

/**
 * Find the one object whose name starts with a prefix.
 * @param objects - Every object name in the local object database, sorted.
 * @param prefix - Lowercase hexadecimal prefix.
 * @returns The matching object name, or `undefined` when none or several match.
 */
export function uniquePrefixMatch(objects: readonly string[], prefix: string): string | undefined {
  let low = 0
  let high = objects.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((objects[middle] ?? prefix) < prefix) low = middle + 1
    else high = middle
  }
  const match = objects[low]
  if (match?.startsWith(prefix) !== true || objects[low + 1]?.startsWith(prefix) === true) return undefined
  return match
}

/**
 * Resolve commit-identifier candidates in maintained sources against the local object database.
 * @param repoRoot - Working tree whose Git objects are inspected.
 * @param sources - File texts or symlink targets to extract candidates from.
 * @returns Lowercase candidates containing a hexadecimal letter that name exactly one available object, which is a commit.
 */
export function repositoryCommits(repoRoot: string, sources: Iterable<string>): Set<string> {
  const candidates = [...new Set([...sources].flatMap(source =>
    [...source.matchAll(commitCandidate)].map(match => match[0].toLowerCase())))]
  if (candidates.length === 0) return new Set()
  // Git resolves prefixes across all available objects, including unreachable and alternate ones;
  // one listing of those objects replaces one Git prefix lookup per candidate.
  // Ambiguous prefixes do not identify one object and cannot establish a commit reference.
  const objects = gitLines(repoRoot, ['cat-file', '--batch-all-objects', '--batch-check=%(objectname)'], objectListingLimit).sort()
  const matches = new Map<string, string>()
  for (const candidate of candidates) {
    const object = uniquePrefixMatch(objects, candidate)
    if (object !== undefined) matches.set(candidate, object)
  }
  if (matches.size === 0) return new Set()
  const matched = [...new Set(matches.values())]
  const commits = new Set(gitLines(repoRoot, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], gitOutputLimit, `${matched.join('\n')}\n`)
    .map(line => line.split(' '))
    .filter(([, type]) => type === 'commit')
    .map(([object]) => object))
  return new Set([...matches].filter(([, object]) => commits.has(object)).map(([candidate]) => candidate))
}

/**
 * Scan tracked and nonignored new files using only the local Git object database.
 * @param repoRoot - Working tree whose files and Git objects are inspected.
 * @returns Prohibited references outside vendor and frozen Agent Notes; absent shallow-history objects cannot match.
 */
export function scanRepositoryReferences(repoRoot: string): RepositoryReference[] {
  const sources = readMaintainedFiles(repoRoot)
  const commits = repositoryCommits(repoRoot, sources.values())
  return [...sources].flatMap(([file, source]) => findRepositoryReferences(file, source, commits))
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  const references = scanRepositoryReferences(root)
  if (references.length === 0) {
    console.log('verify-repository-references: maintained files contain no prohibited references (decimal-only tokens are ignored).')
  } else {
    console.error('verify-repository-references: use release tags or maintained repository links:')
    for (const { file, line, kind } of references) console.error(`  ${file}:${String(line)} ${kind}`)
    process.exitCode = 1
  }
}
