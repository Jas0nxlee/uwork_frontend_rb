# Agent Note: Product-selected native authorization

Status: implemented

English | [中文](2026-11-10-native-product-authorization.zh.md)

## Problem

An enterprise account and its organization-scoped credentials cannot share the DeepSeek account provider's identity or login state. A renderer-hosted login page would also put authorization callbacks in the application renderer and mix third-party browser state with the workspace.

## Decision

The product layer installs `native-authorization` and registers one identity-owned provider. Its neutral definition owns selection, safe organization choices and status; the enterprise provider owns protocol requests, verification, credential storage, attempt generations and late-result rejection. An absent provider retains the standard DeepSeek Welcome. Main contains no enterprise issuer or organization branch.

The Desktop Host invokes the provider through a private Node IPC broker. Main and Host validate request and response fields, correlate numeric request IDs and return fixed diagnostic text on failure. The Host forwards the neutral `native-authorization/changed` event without importing a business identity service. Renderer IPC accepts only organization selection, bounded view geometry and attempt cancellation or polling; it has no callback-completion operation. Authorization URLs and intercepted codes stay on Host/Main IPC. The broker aborts in-flight work on request cancellation, explicitly cancels owned returned attempts, cancels a successful start reply that arrives after withdrawal, and awaits all owned work during shutdown. A renderer cannot restore authority by retaining an old attempt ID.

Desktop Host protocol generation 5 requires the private native authorization state/control exchange, including a null state for standard products. Release metadata rejects generation 4 before a cached Host can wait indefinitely on an unsupported request.

Main admits only an attached window's exact main frame and creates a fresh nonpersistent `WebContentsView` session for each attempt. The guest has sandboxing and context isolation, no Node integration, preload, webview or DevTools, and denies permissions, windows and downloads. Navigation permits only validated HTTPS origins. Callback interception additionally checks the exact callback path and fixed query values, rejects duplicate nonce values and never loads an unmatched callback into the guest. Completion is a private closure with an abort signal. Window closure, main-frame replacement, renderer failure, cancellation, attempt replacement, update handoff and quit withdraw the surface. Teardown destroys the document, closes connections and awaits storage, cache and HTTP authentication removal; cleanup failures remain observable to the shell lifecycle owner. Every terminal status read uses that same settlement path, including a status read after a rejected expiry poll, so a stale QR document cannot remain above the recovered entry.

Welcome selects its page from the safe provider state. Host session-loss notifications return an admitted workspace to Welcome. A verified callback or handoff admits the workspace without putting an enterprise identity into the DeepSeek account service. The provider's cancellation and credential-generation checks remain authoritative even if a native browser or process fails.

## Alternatives considered

Extending the DeepSeek account union would couple independent credentials and business protocols. Reusing a generic text prompt would hide the native browser lifetime and callback owner. A renderer iframe or persistent browser partition would expose callback navigation or retain authentication between attempts. A business-specific Main branch would make every new product modify the shell. The neutral private provider plus Host broker preserves product selection while keeping each identity provider responsible for its own credential commits.

## Consequences

Focused tests cover every statement, branch and function of the neutral registry, Main controller and native carrier, including stale start replies, callback replay, owner withdrawal and failed cleanup. A real profile composition verifies the configured four organization choices without employee credentials. Production-component browser fixtures inspect localized controls, light and dark themes, pending and expired states and constrained geometry; those fixtures do not establish real employee authorization. A Linux Electron smoke uses an in-memory HTTPS issuer to exercise the production carrier with real sandboxed guests: no Node globals, distinct temporary sessions, cookie and localStorage removal, private callback interception and forced owner destruction. Captured owner WebContents references allow teardown after the BrowserWindow getter becomes unavailable.

Real enterprise completion requires an employee's WeCom device and the configured organization's live callback. Windows x64 and Mac ARM native behavior, installer signing, notarization and signed-update acceptance require their platform machines and signing CI. Linux browser or Electron evidence does not substitute for those release checks, and these tests record no signed-release acceptance.
