/** Independent source-plane writer for cross-process installation tests. */
import { Context } from '@deepseek-ai/cordis'
import { CompanyInstallStore } from '../../src/install-store.ts'
import type { Config } from '../../src/index.ts'

const [root, encoded, version] = process.argv.slice(2)
if (root === undefined || encoded === undefined || version === undefined) throw new Error('Missing install-worker arguments')
const config = JSON.parse(encoded) as Config
const ctx = new Context()
const store = new CompanyInstallStore(root, config, ctx)
const result = await store.install('weather', version, AbortSignal.timeout(30000))
process.stdout.write(JSON.stringify(result) + '\n')
await ctx.fiber.dispose()
