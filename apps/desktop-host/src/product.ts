/** Packaged distribution identity shared by Electron, its CLI and packaging. */
import { join } from 'node:path'
import { homedir } from 'node:os'

/** Public product metadata; never contains credentials or runtime package versions. */
export interface DesktopProduct {
  readonly name: string
  readonly appId: string
  readonly userData: string
  readonly defaultHome: string
  readonly protocol: string
  readonly artifactStem: string
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Decode optional distribution metadata without changing upstream manifests.
 * @param manifest - parsed application manifest.
 * @returns validated identity, or undefined for an uncustomized application.
 * @throws when declared metadata is invalid.
 */
export function desktopProduct(manifest: unknown): DesktopProduct | undefined {
  if (!object(manifest)) throw new Error('desktop product: expected an application manifest')
  const value = manifest.dshDesktopProduct
  if (value === undefined) return undefined
  if (!object(value)) throw new Error('desktop product: expected dshDesktopProduct fields')
  const text = (key: string): string => {
    const field = value[key]
    if (typeof field !== 'string' || field.trim() !== field || !field || /[\x00-\x1f]/u.test(field)) {
      throw new Error(`desktop product: invalid ${key}`)
    }
    return field
  }
  const name = text('name'), appId = text('appId'), userData = text('userData')
  const defaultHome = text('defaultHome'), protocol = text('protocol'), artifactStem = text('artifactStem')
  if (!/^[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/u.test(appId)
    || /[<>:"/\\|?*]/u.test(userData) || userData === '.' || userData === '..'
    || !/^~\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/u.test(defaultHome)
    || defaultHome.split('/').some(segment => segment === '.' || segment === '..')
    || !/^[a-z][a-z0-9-]+$/u.test(protocol) || !/^[a-z0-9][a-z0-9-]*$/u.test(artifactStem)) {
    throw new Error('desktop product: invalid installation identity or default home')
  }
  return { name, appId, userData, defaultHome, protocol, artifactStem }
}

/**
 * Establish a distribution default before profile, credentials or plugin loading.
 * @param manifest - application manifest carrying optional product metadata.
 * @param environment - launch environment to update; an explicit DSH_HOME wins.
 */
export function initializeDesktopHome(manifest: unknown, environment: NodeJS.ProcessEnv): void {
  const product = desktopProduct(manifest)
  if (product === undefined || environment.DSH_HOME?.trim()) return
  environment.DSH_HOME = join(homedir(), ...product.defaultHome.slice(2).split('/'))
}
