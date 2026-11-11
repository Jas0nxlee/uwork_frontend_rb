/** Origin-scoped TLS compatibility for enterprise services. */
import type { Context } from '@deepseek-ai/cordis'
import { Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { z } from 'zod'
import { createRouteDispatcher } from '@deepseek-ai/dsh-http-proxy'

/** Explicit service origins and TLS curve preference; certificate verification remains enabled. */
export const Config = z.object({
  origins: z.array(z.url()).min(1),
  ecdhCurve: z.string().min(1),
})

class OriginDispatcher extends Dispatcher {
  constructor(private readonly origins: ReadonlySet<string>, private readonly transport: Dispatcher,
    private readonly fallback: Dispatcher) { super() }

  override dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean {
    const origin = String(options.origin)
    return (this.origins.has(origin) ? this.transport : this.fallback).dispatch(options, handler)
  }
}

/** Install scoped TLS transport while preserving the launcher's proxy policy.
 * @param ctx - scope owning the dispatcher and restoration.
 * @param config - exact HTTPS origins and key-exchange preference.
 */
export async function apply(ctx: Context, config: z.infer<typeof Config>): Promise<void> {
  const origins = new Set(config.origins.map((value) => {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
      throw new Error('Enterprise TLS transport requires exact HTTPS origins')
    }
    return url.origin
  }))
  const transport = await createRouteDispatcher({ get: (name) => {
    const value = process.env[name]
    return value === undefined ? undefined : { value }
  } }, { ecdhCurve: config.ecdhCurve })
  const fallback = getGlobalDispatcher()
  const routed = new OriginDispatcher(origins, transport, fallback)
  ctx.effect(() => {
    setGlobalDispatcher(routed)
    return async () => {
      if (getGlobalDispatcher() === routed) setGlobalDispatcher(fallback)
      await transport.close()
    }
  })
}
