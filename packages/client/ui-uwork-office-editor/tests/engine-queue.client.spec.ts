/** Shared SDK working state is borrowed by one temporary editor operation at a time. */
import { expect, it, vi } from 'vitest'
import { createOfficeEngineQueue } from '../src/client/engine-queue.ts'

it('serializes documents through asynchronous cleanup and drains admitted work', async () => {
  const queue = createOfficeEngineQueue()
  const firstResult = Promise.withResolvers<string>()
  const first = vi.fn(() => firstResult.promise)
  const second = vi.fn(async () => 'second')
  const left = queue.run(first, new AbortController().signal)
  const right = queue.run(second, new AbortController().signal)
  let idle = false
  const drained = queue.idle().then(() => { idle = true })
  await Promise.resolve()
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).not.toHaveBeenCalled()
  expect(idle).toBe(false)
  firstResult.resolve('first')
  expect(await left).toBe('first')
  expect(await right).toBe('second')
  await drained
  expect(idle).toBe(true)
})

it('refuses a cancelled queued operation and continues after another operation fails', async () => {
  const queue = createOfficeEngineQueue()
  const failed = new Error('export failed')
  await expect(queue.run(async () => { throw failed }, new AbortController().signal)).rejects.toBe(failed)
  const cancelled = new AbortController()
  cancelled.abort()
  const operation = vi.fn(async () => 'unexpected')
  await expect(queue.run(operation, cancelled.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(operation).not.toHaveBeenCalled()
  expect(await queue.run(async () => 'next', new AbortController().signal)).toBe('next')
  await queue.idle()
})
