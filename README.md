# UWork Next

English | [中文](README.zh.md)

UWork Next is a desktop AI workspace for enterprise users. Sign in with Enterprise WeChat to access your organization's authorized models, company skills, and gateway usage in one application.

## Features

- **Enterprise sign-in** — scan with Enterprise WeChat to connect your organization and automatically configure authorized models.
- **AI conversations** — create conversations, attach files, and work with tools in your workspace. Models with the relevant capabilities support image input and adjustable reasoning effort.
- **Managed models** — use company-provided UCAS models alongside your personal providers. Enterprise-managed provider settings are maintained by the application.
- **Company market** — browse, install, and manage skills published by your organization.
- **Enterprise usage** — view gateway request counts, token usage, success rates, and reported costs by period.
- **Workspaces** — organize conversations and tasks, and use file previews and terminals while working.

## Download and install

Download the installer for your platform from [GitHub Releases](https://github.com/Jas0nxlee/uwork_frontend_rb/releases).

| Platform | Installer |
| --- | --- |
| macOS on Apple Silicon | Mac ARM `.dmg` |
| Windows x64 | Windows `.exe` |

The installed application is named **UWork Next**. Current releases are unsigned previews. Read the release notes for the version's verification results and installation details.

<a id="run"></a>

## Get started

1. Install and open UWork Next.
2. Choose your organization and sign in with Enterprise WeChat.
3. After your authorized models are configured, select a model in the conversation input area.
4. Create a conversation and send a message. Attach files or use workspace tools as needed.
5. Open the company market to manage company skills, or enterprise usage to review gateway activity.

Model availability follows your organization's authorization. Image input and reasoning options depend on the selected model.

## Local data

Workspace configuration and conversation data are stored under the current user's `.uwork` directory by default. Back up the application data before moving to another computer.

<a id="run-from-source"></a>

## Build from source

Use Node.js 24.9 or later and pnpm 11.28.5 in this repository.

```sh
pnpm install --frozen-lockfile
pnpm run build
```

Desktop packaging instructions are in the [packaging guide](apps/desktop/packaging/README.md).

## Feedback

Report problems and feature requests in [this project's Issues](https://github.com/Jas0nxlee/uwork_frontend_rb/issues). Include the application version, operating system, reproduction steps, and relevant logs with credentials and personal information removed.

## License

[MIT](LICENSE). Third-party license notices are available in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
