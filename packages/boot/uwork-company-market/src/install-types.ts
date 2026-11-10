/** Public installation facts and configurable content-store budgets. */
import type { ArchiveLimits } from './archive.ts'

/** One active version of a company-owned installed skill. */
export interface InstalledCompanySkill {
  /** Canonical catalog slug. */
  readonly slug: string
  /** Exact published version. */
  readonly version: string
  /** Verified compound content fingerprint. */
  readonly fingerprint: string
  /** Whether future skill discovery may include this version. */
  readonly enabled: boolean
  /** Number of verified regular files. */
  readonly fileCount: number
}

/** Installation availability and current installed versions. */
export interface CompanyInstallations {
  /** False for catalog-only compositions without an installation directory. */
  readonly available: boolean
  /** One current version per installed canonical slug. */
  readonly skills: readonly InstalledCompanySkill[]
}

/** Installation storage and transport budgets. */
export interface InstallLimits extends ArchiveLimits {
  /** Maximum downloaded ZIP bytes. */
  readonly maxArchiveBytes: number
  /** Complete installation deadline in milliseconds, including lock acquisition. */
  readonly installTimeoutMs: number
  /** Maximum wait for another process's installation writer, in milliseconds. */
  readonly lockWaitMs: number
  /** Maximum bytes in the activation index or one version manifest. */
  readonly maxManifestBytes: number
  /** Maximum installed skills in this store. */
  readonly maxInstalledSkills: number
  /** Maximum retained immutable versions across all installed skills. */
  readonly maxStoredVersions: number
}
