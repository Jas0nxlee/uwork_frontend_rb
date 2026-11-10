---
description: "UWork workbench presentation over the native retained tab and docking surface."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-uwork-workbench

English | [中文](README.zh.md)

## Summary

Apply UWork tab-strip presentation to the native workbench. Files, browser pages, terminals and document previews keep their existing tab providers, retained Session ownership and docking controller. The product adds no parallel tab store or viewer.

## Table of Contents

- [Use This Package](#use-this-package)
- [Understand the Implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use This Package

Load this package after `ui-sidebar-right` in a product bundle. It attaches through the Session-scoped `sidebar.right.frame` HOC and is absent from ordinary products. The Host entry is inert. With no frame registrant the native rightbar renders its original children and Dockkit uses its unchanged CSS fallbacks.

The product frame inherits the application's semantic light and dark colors. Its equal tab basis is 156px with a 60px floor and 156px maximum; the native 28px content band, 8px corner token, close affordances and keyboard focus indication remain. These geometry values follow `packages/ui/src/app-shell/SidePaneTabTrigger.tsx` in the [source frontend](https://github.com/Jas0nxlee/UWork_frontend).

## Understand the Implementation

`WorkbenchFrame` uses `display: contents`, so it creates no containing block, stacking context or replacement docking root. It scopes the [Dockkit presentation variables](../ui-dockkit/README.md#embedding-it). The rightbar supplies committed `active`, `expanded` and `fullscreen` state; the frame changes no state, handlers, tab identities or child keys.

`ui-sidebar-right` continues to own retained Sessions, per-tab lifetimes and resource routing. `ui-dockkit` owns focus, tab selection, overflow measurements, close gestures, dragging, floating and split geometry. Document, code, Office, terminal and browser providers keep their own read and editing policies. The frame does not turn a read-only preview into an editor.

## Further Exploration

- [Right sidebar](../ui-sidebar-right/README.md)
- [Dockkit](../ui-dockkit/README.md)
- [UWork product theme](../ui-uwork/README.md)

## Model Experience

None, as workbench presentation contributes no model input or tool.

#### KV Cache effect

This package changes no prompts, messages, model requests or cache keys.

## Known Limitations and Deferred Work

- This package changes the native tab strip and surface presentation. It does not port the source application's tab store, terminal engine, browser engine or document editor.
- Real-provider acceptance covers Linux bash PTY, read-only XLSX and DOCX previews. It does not establish Office editing, other document formats or Windows/macOS terminal behavior. Web Browser retains navigation and intentionally remounts after hiding; Desktop keeps its existing resident-guest policy.

### Dev Note

The actual Web composition test opens a long-named read-only workspace preview and the standard Browser provider, whose external HTTPS document is synthetic. It checks both themes at 1680px, 760px and 390px, native split and close controls, and a floating Browser document.

On Linux it also runs harmless `printf` and `pwd` commands through the real bash PTY, retains its process and output across tab switching and 1680px/390px theme changes, and verifies process exit on close. Real XLSX bytes render through the spreadsheet Worker without accepting cell edits. Real DOCX bytes use the existing LibreOfficeKit-to-PDF endpoint and PDF Worker, including Chinese text; both previews leave the source bytes unchanged.

Focused tests cover effect-owned registration and withdrawal, committed frame state, retained input and focus across presentation changes, and native selection, splitting, floating and closing across file, browser, terminal and document tab kinds. The shared rightbar and Dockkit regression suites protect the uncustomized behavior. Run `node_modules/.bin/vitest run --config vitest.web.config.ts --maxWorkers=1 apps/web/tests/uwork-workbench.e2e.ts` after building artifacts for the actual-page regression and its owner-local accessibility snapshot.
