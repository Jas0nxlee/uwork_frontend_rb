import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import NativeAuthorization from '../src/index.ts'
import type { NativeAuthorizationProvider, NativeAuthorizationState } from '../src/types.ts'

function provider(): NativeAuthorizationProvider {
  return {
    getState: vi.fn(async (): Promise<NativeAuthorizationState> => ({ status: 'signed-out', choices: [] })),
    start: vi.fn(), complete: vi.fn(), poll: vi.fn(), cancel: vi.fn(),
  }
}
it('selects one product provider and withdraws it with registration lifetime', async () => {
  const ctx = new Context()
  await ctx.plugin(NativeAuthorization)
  expect(ctx.nativeAuthorization.getProvider()).toBeUndefined()
  const selected = provider()
  const dispose = ctx.nativeAuthorization.register(selected)
  expect(ctx.nativeAuthorization.getProvider()).toBe(selected)
  expect(() => ctx.nativeAuthorization.register(provider())).toThrow('already registered')
  dispose()
  expect(ctx.nativeAuthorization.getProvider()).toBeUndefined()
})

it('publishes safe product state independently of any business identity service', async () => {
  const ctx = new Context()
  const service = ctx.plugin(NativeAuthorization)
  await service.await()
  const changed = vi.fn()
  const release = ctx.on('native-authorization/changed', changed)
  const state: NativeAuthorizationState = { status: 'signed-out', choices: [{ id: 'organization', label: 'Organization' }] }
  ctx.emit('native-authorization/changed', state)
  expect(changed).toHaveBeenCalledWith(state)
  release()
  ctx.emit('native-authorization/changed', state)
  expect(changed).toHaveBeenCalledOnce()
  await service.dispose()
})
