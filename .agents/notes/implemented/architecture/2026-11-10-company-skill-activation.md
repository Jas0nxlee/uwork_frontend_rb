# Agent Note: Company skill activation through immutable content

Status: implemented

English | [中文](2026-11-10-company-skill-activation.zh.md)

## Problem

PUBLIC SkillHub distributes instruction archives, while the existing plugin manager installs executable npm bundles. Treating these payloads alike gives a content download package-install authority and lets failed updates destroy the instructions that running work references. Cancellation or a lost write acknowledgement can also leave an activation outcome uncertain.

## Decision

The [company market](../../../../packages/boot/uwork-company-market/README.md) owns a separate content store. It verifies an exact resolver identity, portable archive paths, bounded decompression, published compound fingerprint and native instruction parsing before activation. Immutable generations become visible through one atomic index replacement under a cross-process writer lock. Skill reads use atomic index snapshots so a download cannot block access to the active version. The index retains previously committed generations until explicit uninstall; recovery removes only owned staging and unreferenced candidates.

A failed write acknowledgement triggers index readback. An unreadable outcome retains the candidate and blocks trusted state presentation rather than assuming rollback. Skill discovery reuses the native filesystem provider, with company roots ranked after personal roots; installation management never changes personal skills or npm bundles.

## Alternatives considered

- Reusing npm installation would execute a different payload protocol and mix ownership with ordinary plugins.
- Replacing a skill directory in place would invalidate paths held by active work and complicate interruption recovery.
- Deleting every candidate after a reported write failure would remove content referenced by a committed but unacknowledged index.

## Consequences

The index is the activation authority; corrupt saved state requires repair rather than an empty-store fallback. Retained generations consume a configurable budget until uninstall. Atomic replacement does not promise power-loss durability, and content integrity does not establish execution safety: native permissions and approvals continue to govern tools.
