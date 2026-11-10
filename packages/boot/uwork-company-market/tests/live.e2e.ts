/** Opt-in public-service verification; no credentials and no execution of downloaded instructions. */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import CompanyMarket from '../src/index.ts'

it.runIf(process.env.UWORK_MARKET_LIVE === '1')('installs the public weather sample and loads it through the native provider', async () => {
  const root = await mkdtemp(join(tmpdir(), 'uwork-market-live-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  await ctx.plugin(SkillRegistry).await()
  await ctx.plugin(CompanyMarket, { baseUrl: 'https://aihub.ucas.com.cn/skillhub', installDir: root }).await()
  const market = ctx.get('uworkCompanyMarket')!, skills = ctx.get('skills')!
  const installed = await market.installSkill('weather', '1.0.0', AbortSignal.timeout(120000))
  expect(installed).toMatchObject({ slug: 'weather', version: '1.0.0', enabled: true,
    fingerprint: 'sha256:0f94e922d372c96950684af5fa48cccc91f7f374335f2be9acb53eabd7cf3dd0' })
  expect(await skills.get('weather')).toMatchObject({ name: 'weather', source: 'company-market' })
  await market.uninstallSkill('weather', AbortSignal.timeout(30000))
  expect(await skills.list()).toEqual([])
}, 150000)
