# Agent Note: UWork Preview release isolation

Status: implemented

English | [中文](2026-11-10-uwork-preview-release-isolation.zh.md)

## Problem

A desktop fork can display a new product name while still packaging the upstream icon, embedding its update feed, or overwriting its fixed website installer. Sharing those release destinations makes a Preview build affect existing dsh installations even when its user-data directory is isolated.

## Decision

UWork Next Preview uses the product identity declared in the desktop application manifest. Packaging selects the existing UWork native artwork without modification. The source commit and asset hashes live beside the [brand resources](../../../../apps/desktop/resources/uwork/README.md). Other product selections retain their original artwork.

The updater resolver accepts an explicit distribution identity. UWork Preview uses `uwork-next/<release-id>` for both feed and binary keys, requires a separate HTTPS test origin, and rejects the legacy production deployment and DeepSeek origins. The pure resolver retains existing dsh behavior when no UWork distribution is selected.

Builder configuration, package completion records, macOS artifact assembly, environment validation, next-version discovery and credential destination checks pass the same distribution identity. Ordinary upload plans read the actual application manifest. Retained publication instead reads the immutable source distribution marker; older retained manifests explicitly select the legacy namespace without consulting the current checkout. Preview rejects fixed website installer replacement and purge before loading release credentials; it cannot write or purge `dsh-latest` through those commands.

This decision covers the implemented branding and release-routing slice. It does not classify the entire desktop migration as complete. Product classification keeps enterprise identity, native authorization, gateway protocol/orchestration and managed model provisioning optional to the UWork composition. Their README audits distinguish authentication/transport from model requests owned by native provider adapters.

The fixed upstream compatibility baseline is preserved in the versioned [audit transcript](../../../../tasks/fixtures/upstream-maintenance.json). The repository-reference gate admits commit identities only at that exact evidence path and only for canonical readable JSON with a bounded, versioned schema: fixed read-command arguments, matching successful outputs, hexadecimal object IDs, the reviewed shared-source scopes and a fixed statement that no branch, index or worktree changed. Extra fields, arbitrary prose, malformed IDs, failed commands and the same content at another path retain normal reference checks. This narrow evidence rule preserves reproducible T40 baselines without permitting historical commit links in maintained prose.

## Alternatives considered

**Reuse the upstream update namespace.** Rejected because an independent app name and home do not prevent feed metadata or fixed installer writes from affecting upstream consumers.

**Disable every update path for Preview.** Rejected because an independent test namespace preserves repeatable signed upgrade qualification while legacy production and website destinations remain closed.

**Redraw the UWork icon.** Rejected because the user supplied an existing product repository with native brand assets. Reusing those assets preserves provenance and avoids inventing a new product mark.

**Keep the fixed baseline only in scratch.** Rejected because a reviewer receiving a clone would lose the exact audit inputs and observed outputs. The versioned schema retains those facts while keeping ordinary maintained-reference restrictions.

## Consequences

Preview candidates can share packaging machinery with dsh without sharing its update objects. A signed Preview needs its own test origin, release ID and signing environment. Existing production presets intentionally fail for this distribution. Unsigned candidates remain separate artifacts without updater configuration.

Real Windows x64 and Mac ARM signing, installation and upgrade acceptance remain unverified in the Linux development environment. There are no bound signing secrets or platform test machines. Original UWork macOS workflow ad hoc signing is not Developer ID or notarization evidence. Real employee login, provisioned inference and account switching require an authenticated test identity. Public service discovery and synthetic fixtures cannot satisfy those checks.

The [release qualification matrix](../../../../apps/desktop/resources/uwork/README.md) owns the required platform evidence. This change performs no artifact upload, public release, old-feed switch or signing-token operation.

## Testing

Focused tests verify independent feed/binary paths, legacy production and DeepSeek-origin rejection, early fixed-installer/purge rejection, retained plain dsh resolver behavior, packaged native branding, macOS feed assembly and upload-plan validation. Related packaging, environment and next-version tests pass. These are source and fixture checks; their mock signing/upload output is not evidence of a real release.

The repository-reference specs also admit the exact audit fixture and reject renamed paths, widened schemas, arbitrary commands, malformed object identities, failed outputs and trailing prose.

The retained manifest keeps schema version 1 and adds optional `source.distribution.artifactStem`. New retention extracts the validated packaged identity; older manifests remain readable. Older strict publishers need upgrading to read new customized manifests. Receipt URLs still bind the destination: missing or incorrect Preview markers cannot redirect a Preview receipt into a legacy feed. The mechanical persistence check reports 66 unchanged roots and 24 history records; this CI manifest is outside that inventory, so this note and the CI publication reference record its compatibility acknowledgement.

The host flock readiness probe now checks the current platform/libc Node-API flock binary. Host-only native builds need neither landlock nor the other libc binary. Executable-mode fixtures explicitly establish their intended mode before testing cache reuse, preserving assertions under restrictive runner umasks. Thirteen focused release files pass 151 tests with two platform-only skips, including cross-process cache publication, real addon loading, retained identity and receipt consistency.
