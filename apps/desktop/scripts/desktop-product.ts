/** Distribution metadata shared by packaging and artifact verification. */
import { readFileSync } from 'node:fs'
import { desktopProduct } from '../../desktop-host/src/product.ts'

/** Product metadata declared by this checkout's Electron application manifest. */
export const desktopDistribution = desktopProduct(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')))
/** Installed application and executable name, shared with electron-builder. */
export const desktopProductName = desktopDistribution?.name ?? 'DeepSeek Harness'
/** Download artifact prefix, shared with electron-builder. */
export const desktopArtifactStem = desktopDistribution?.artifactStem ?? 'deepseek-harness'
