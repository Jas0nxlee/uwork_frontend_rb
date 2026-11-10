/** Distribution-owned bundle order shared by preparation, launch and recovery. */
import type { DesktopProduct } from '@deepseek-ai/dsh-desktop-host'
import { PROFILE_TEMPLATES, type ProfileTemplate } from '@deepseek-ai/dsh-official-bundles'

/**
 * Resolve the standard Web layers followed by the distribution's additional bundles.
 * @param product - Validated application identity and optional product layers.
 * @returns Ordered, nonduplicated bundles required by the Desktop distribution.
 * @throws When a product layer repeats a standard Web bundle.
 */
export function resolveDesktopProfileBundles(product?: DesktopProduct): readonly string[] {
  const web = PROFILE_TEMPLATES.web as ProfileTemplate
  const bundles = [...web.bundles, ...product?.bundles ?? []]
  if (new Set(bundles).size !== bundles.length) throw new Error('desktop product: duplicate profile bundle')
  return bundles
}
