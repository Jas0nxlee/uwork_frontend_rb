# UWork native brand assets

English | [中文](README.zh.md)

Copied without modification from `Jas0nxlee/UWork_frontend`, commit
`f6dda23d7e6f39aa66804933b60f893d38ab6914`, `packages/desktop/build`:

| This directory | Source | SHA-256 |
| --- | --- | --- |
| icon.svg | uwork.svg | d39392cc3a71e453bc6af9d3b93af09e0e2b909333cce3d04c1a039e8fec27ec |
| icon.png | icon.png | 9819aa0c3b42795f070333d9db5865614b4b331a54d4549282c3f59e4780b9f8 |
| icon.ico | icon.ico | eac51bbf017034a23c1b661b7c1f3901935180bba0a76aca6abb79a53a3f111c |
| icon.icns | icon.icns | 2cadce8d5a13feb46f256c6ce219fee4d6db7e87fe9e3ab29d6eeed72af02978 |

The `uwork-next` distribution uses PNG for Windows executable/About,
ICO for the Windows tray, and the native ICNS for macOS. Other distributions
retain their original assets. No artwork was invented or recolored.

The recorded hashes identify the source files copied for this brand. They do not establish code
signing, notarization, installation, update acceptance, or permission to publish.

## Release qualification

Local unsigned candidates use `package:win:x64:unsigned` or
`package:mac:arm64:unsigned` on the corresponding host. They carry an unsigned
suffix, do not embed updater configuration, and are not release evidence.
Signed Preview candidates require a separate HTTPS test origin and retain the
32-hex release ID. Their feeds and binaries are below `uwork-next/<release-id>`.
Production deployment and DeepSeek origins are rejected. Preview cannot replace
`dsh-latest` website installers. Upload authorization remains a separate decision.

Before checking T36–T39, retain results from real Windows x64 and Mac ARM hosts:

| Check | Required evidence |
| --- | --- |
| Windows signing | Publisher, trusted timestamp, every bundled executable/helper, NSIS installer |
| macOS signing | Developer ID, hardened runtime, nested helpers, notarization and stapling |
| Installation | Standard user, no external Node/pnpm, spaces and Chinese path, Applications launch |
| Enterprise flow | Real employee login, model provisioning, account switching/logout, company skill, usage |
| Upgrade | Two consecutive signed versions, isolated feed, offline/hash/signature failures and retry |
| Data isolation | Legacy UWork/dsh directories unchanged; Preview home used by Host, CLI and children |

The Linux checks cannot satisfy this matrix. The original source workflow uses
macOS ad hoc signing and is not a substitute for Developer ID/notarization.
