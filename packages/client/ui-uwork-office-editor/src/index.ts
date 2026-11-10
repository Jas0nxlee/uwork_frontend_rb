/** Host configuration for the optional UWork Office editor. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Config } from './config.ts'

export { Config } from './config.ts'

/**
 * Embed validated editor policy in pages served by this Host.
 * @param ctx - Host page-serving context.
 * @param config - parser limits and revision author applied to new editor lifetimes.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__UWORK_OFFICE_EDITOR_CONFIG__', value: config })
  })
}
