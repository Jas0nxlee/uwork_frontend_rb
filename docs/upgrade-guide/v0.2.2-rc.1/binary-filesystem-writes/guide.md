---
kind: upgrade-guide
description: "FileSystem providers must implement guarded raw-byte publication through writeBytes."
---

# Binary filesystem publication

English | [中文](guide.zh.md)

## Change

`FileSystem` now requires `writeBytes(target, content, expected, signal?, sandboxPolicy?)`, returning `FsBinaryWriteOutcome`. Third-party providers extending `FileSystem` must implement the new method. Local, sandbox and SSH providers are updated together. Existing text methods and Session formats are unchanged.

Binary writes require `createIfAbsent` or `replaceIfVersion`; they return operation and version without text diff fields. Local writes snapshot bytes and recheck the version before atomic publication. The sandbox provider enforces the per-call policy, and SSH validates Base64 and its 8 MiB transfer limit.

## Migration

1. Implement `writeBytes` in each custom filesystem provider using `Uint8Array` content and the required `FsWriteIntent`.
2. Preserve target resolution, sandbox checks, cancellation, atomic publication and stale-version failures. Do not decode binary content as UTF-8 or silently perform unguarded replacement.
3. Update provider fixtures and consumers. Use the returned version for subsequent saves; a stale version must preserve the existing file.
4. Verify non-UTF-8 round trips, create conflicts, stale replacements, cancelled saves and read-only denials against the actual provider.
