/** Editor policy is validated on the Host and embedded only while its plugin is mounted. */
import type { WebServer, IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import { apply, Config } from '../src/index.ts'

it('embeds validated policy and removes its page contribution on unload', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const peer: Parameters<WebServer['renderIndex']>[1] = {
    id: 'office-page' as Parameters<WebServer['renderIndex']>[1]['id'],
    ctx, principal: { kind: 'owner' }, signal: new AbortController().signal, interactions: 'none',
    dispose: async () => {},
  }
  const config = Config({ maxDocumentXmlBytes: 1024, minRetainedTextRatio: 0.75, revisionAuthor: 'Review team' })
  const fiber = ctx.plugin({ apply, Config }, config)
  await fiber.await()
  const table: IndexInjection[] = []
  ctx.emit('webserver/index-inject', table, peer)
  expect(table).toEqual([{ kind: 'global', name: '__UWORK_OFFICE_EDITOR_CONFIG__', value: config }])
  await fiber.dispose()
  const after: typeof table = []
  ctx.emit('webserver/index-inject', after, peer)
  expect(after).toEqual([])
})

it('applies deployment defaults and refuses invalid parser limits or revision identity', () => {
  expect(Config({})).toEqual({ maxDocumentXmlBytes: 4 * 1024 * 1024, minRetainedTextRatio: 0.8, revisionAuthor: 'UWork' })
  for (const invalid of [{ maxDocumentXmlBytes: 0 }, { minRetainedTextRatio: 1.1 }, { minRetainedTextRatio: -1 }, { revisionAuthor: '' }]) {
    expect(() => Config(invalid)).toThrow()
  }
})
