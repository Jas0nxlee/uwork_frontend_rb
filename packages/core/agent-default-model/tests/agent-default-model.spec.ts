/** Default model references remain live without a settings service. */
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished, vi } from 'vitest'
import DefaultModel from '../src/index.ts'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'

it('reads complete selections from volatile config and clears omitted reasoning effort', async () => {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const live = await liveConfig(ctx, DefaultModel, { provider: 'p', model: 'm' })
  const consumer = ctx.agentDefaultModel
  await live.update({ provider: 'q', model: 'n', reasoningEffort: 'high' })
  expect(consumer.currentSelection()).toEqual({ provider: 'q', model: 'n', reasoningEffort: 'high' })
  await live.replace({ provider: 'p', model: 'm' })
  expect(consumer.currentSelection()).toEqual({ provider: 'p', model: 'm' })
  await consumer.saveSelection({ provider: 'unsaved', model: 'unsaved' })
  expect(consumer.currentSelection()).toEqual({ provider: 'p', model: 'm' })
})

it('persists complete selections through its owning profile entry', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ReasoningEffortId } = await import('@deepseek-ai/dsh-llm')
  const { ctx } = await configurationFixture({ hmr: false })
  await ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'next', reasoningEffort: ReasoningEffortId('high') })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'next', reasoningEffort: 'high' })
  await ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'final' })
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'final' })
  const standalone = new Context()
  onTestFinished(() => standalone.fiber.dispose())
  await standalone.plugin(DefaultModel, { provider: 'test', model: 'original' })
  await standalone.agentDefaultModel.saveSelection({ provider: 'test', model: 'ignored' })
  expect(standalone.agentDefaultModel.currentSelection().model).toBe('original')
})

it('serializes overlapping saves and continues after a rejected write', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ctx } = await configurationFixture({ hmr: false })
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const editor = ctx.configEditor
  const edit = editor.edit.bind(editor)
  const calls: string[] = []
  const intercepted = vi.spyOn(editor, 'edit').mockImplementationOnce(async () => {
    calls.push('rejected')
    entered.resolve(undefined)
    await release.promise
    throw new Error('read-only document')
  }).mockImplementation(async (entry, change) => {
    calls.push('saved')
    await edit(entry, change)
  })
  const first = ctx.agentDefaultModel.saveSelection({ provider: 'test', model: 'rejected' })
  const failed = expect(first).rejects.toThrow('read-only document')
  const lastSelection = { provider: 'test', model: 'final' }
  const last = ctx.agentDefaultModel.saveSelection(lastSelection)
  onTestFinished(async () => {
    release.resolve(undefined)
    await Promise.allSettled([failed, last])
    intercepted.mockRestore()
  })
  lastSelection.model = 'mutated'
  await entered.promise
  expect(calls).toEqual(['rejected'])
  release.resolve(undefined)
  await failed
  await last
  expect(calls).toEqual(['rejected', 'saved'])
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'test', model: 'final' })
})

it('conditionally saves only while the expected complete selection still owns the default', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ReasoningEffortId } = await import('@deepseek-ai/dsh-llm')
  const { ctx } = await configurationFixture({ hmr: false })
  const initial = ctx.agentDefaultModel.currentSelection()
  await ctx.agentDefaultModel.saveSelection({ provider: 'enterprise', model: 'allowed' }, initial)
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'enterprise', model: 'allowed' })
  for (const stale of [initial, { provider: 'enterprise', model: 'other' },
    { provider: 'enterprise', model: 'allowed', reasoningEffort: ReasoningEffortId('high') }]) {
    await ctx.agentDefaultModel.saveSelection({ provider: 'late', model: 'late' }, stale)
    expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'enterprise', model: 'allowed' })
  }
})

it('preserves a concurrent personal default from another profile runtime under the file lock', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ctx, start } = await configurationFixture({ hmr: false })
  const other = await start()
  const expected = ctx.agentDefaultModel.currentSelection()
  const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
  const edit = ctx.configEditor.edit.bind(ctx.configEditor)
  vi.spyOn(ctx.configEditor, 'edit').mockImplementationOnce(async (entry, change) => {
    entered.resolve(undefined); await release.promise; await edit(entry, change)
  })
  const pending = ctx.agentDefaultModel.saveSelection({ provider: 'enterprise', model: 'allowed' }, expected)
  onTestFinished(async () => { release.resolve(undefined); await pending })
  expected.model = 'mutated-after-submission'
  await entered.promise
  await other.agentDefaultModel.saveSelection({ provider: 'personal', model: 'chosen' })
  release.resolve(undefined); await pending
  expect(ctx.agentDefaultModel.currentSelection()).toEqual({ provider: 'personal', model: 'chosen' })
  expect(other.agentDefaultModel.currentSelection()).toEqual({ provider: 'personal', model: 'chosen' })
})
it('compares inherited defaults when the editable profile layer omits them', async () => {
  const { configurationFixture } = await import('../../../settings/settings/tests/configuration-fixture.ts')
  const { ctx } = await configurationFixture({ hmr: false })
  vi.spyOn(ctx.configEditor, 'edit').mockImplementationOnce(async (_entry, change) => {
    expect(change({}, { provider: 'test', model: 'original' })).toEqual({ provider: 'enterprise', model: 'allowed' })
  })
  await ctx.agentDefaultModel.saveSelection({ provider: 'enterprise', model: 'allowed' }, { provider: 'test', model: 'original' })
})
