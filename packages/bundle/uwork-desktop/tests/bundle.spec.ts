/** The declarative carrier must mount on the Host without importing browser presentation. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import * as bundle from '../src/index.ts'

it('mounts the profile carrier without a browser or Client services', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  expect('document' in globalThis).toBe(false)
  await ctx.plugin(bundle).await()
})
