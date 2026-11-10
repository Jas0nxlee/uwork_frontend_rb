import { describe, expect, it } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { desktopProduct, initializeDesktopHome } from '../src/product.ts'

const product = {
  name: 'UWork Next Preview', appId: 'io.github.jas0nxlee.uwork.next',
  userData: 'UWork Next Preview', defaultHome: '~/.uwork/harness-preview',
  protocol: 'uwork-next', artifactStem: 'uwork-next',
}

describe('desktop distribution identity', () => {
  it('keeps an ordinary dsh manifest and environment unchanged', () => {
    const environment = {}
    expect(desktopProduct({ name: '@deepseek-ai/dsh-desktop' })).toBeUndefined()
    initializeDesktopHome({}, environment)
    expect(environment).toEqual({})
  })

  it('resolves the distribution home before either Desktop or its CLI loads a profile', () => {
    const environment: NodeJS.ProcessEnv = { DSH_HOME: '  ' }
    initializeDesktopHome({ dshDesktopProduct: product }, environment)
    expect(environment.DSH_HOME).toBe(join(homedir(), '.uwork', 'harness-preview'))
    expect(desktopProduct({ dshDesktopProduct: product })).toEqual(product)
  })

  it('preserves an explicit home and unrelated shared agent configuration', () => {
    const environment = { DSH_HOME: '/explicit/home', DSH_AGENTS_HOME: '/shared/agents' }
    initializeDesktopHome({ dshDesktopProduct: product }, environment)
    expect(environment).toEqual({ DSH_HOME: '/explicit/home', DSH_AGENTS_HOME: '/shared/agents' })
  })

  it.each([
    { userData: '../UWork' }, { defaultHome: '~/.uwork/../.dsh' },
    { protocol: 'https:' }, { appId: '' }, { artifactStem: '../package' }, { name: '' },
  ])('refuses malformed packaged distribution fields: %j', (change) => {
    expect(() => desktopProduct({ dshDesktopProduct: { ...product, ...change } })).toThrow('desktop product')
  })
})
