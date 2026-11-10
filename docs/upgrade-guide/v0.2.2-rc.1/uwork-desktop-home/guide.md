---
kind: upgrade-guide
description: "The UWork desktop distribution uses an isolated home, browser storage and external URL scheme."
---

# UWork desktop installation identity

English | [中文](guide.zh.md)

## Change

This fork's desktop distribution is named UWork Next Preview. Its default Harness home is `~/.uwork/harness-preview`, replacing Desktop's implicit `~/.dsh` default. The bundled CLI uses the same default. An explicit `DSH_HOME` still wins. Electron browser storage is isolated under `UWork Next Preview`, and the external open URL is `uwork-next://open`.

Existing `.dsh`, old UWork data, browser sessions and credentials are not copied automatically. Separately installed npm dsh keeps its existing defaults. Runtime package versions and Session formats are unchanged.

## Migration

1. Start UWork Next Preview and configure or sign in to providers in its isolated profile. Keep existing applications and data available while evaluating it.
2. If an existing dsh home is intentionally required, set `DSH_HOME` explicitly before starting either the application or its bundled CLI. Do not share one writable home between incompatible runtimes.
3. Update desktop-opening integrations to use `uwork-next://open`. The private renderer resource protocol remains unchanged.
4. Confirm new profile data appears under `.uwork/harness-preview/profiles/desktop`; retain old directories for any later explicit import.
