import { describe, expect, it } from 'vitest'
import { desktopProduct } from '../../desktop-host/src/product.ts'
import { resolveDesktopProfileBundles } from '../src/profile-bundles.ts'

const identity = {
  name: 'UWork Next Preview', appId: 'io.github.jas0nxlee.uwork.next',
  userData: 'UWork Next Preview', defaultHome: '~/.uwork/harness-preview',
  protocol: 'uwork-next', artifactStem: 'uwork-next',
}

describe('Desktop product profile layers', () => {
  it('keeps the standard Web composition for an uncustomized distribution', () => {
    expect(resolveDesktopProfileBundles()).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    expect(resolveDesktopProfileBundles(desktopProduct({ dshDesktopProduct: identity })))
      .toEqual(resolveDesktopProfileBundles())
  })

  it('appends configured product layers in their declared order', () => {
    expect(resolveDesktopProfileBundles(desktopProduct({ dshDesktopProduct: {
      ...identity, bundles: ['@deepseek-ai/dsh-uwork-desktop', '@company/extra'],
    } }))).toEqual([
      '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-uwork-desktop', '@company/extra',
    ])
  })

  it('rejects repeating a standard layer in the product configuration', () => {
    expect(() => resolveDesktopProfileBundles(desktopProduct({ dshDesktopProduct: {
      ...identity, bundles: ['@deepseek-ai/dsh-base'],
    } }))).toThrow('duplicate')
  })
})
