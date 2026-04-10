# Local Multi-Provider Chat

React + Express + SQLite based local chat app with per-conversation provider and model selection.

## Supported providers

- OpenAI
- Anthropic
- Gemini
- Ollama
- OpenAI Codex

## Highlights

- Shared chat UI across all providers
- Conversation-level provider and model persistence
- SSE streaming from the server to the web client
- Encrypted provider secrets stored in local SQLite
- OpenAI Codex integrated as a separate `openai-codex` provider
- Codex OAuth callback flow plus optional Codex CLI `auth.json` import
- Workspace runtime with per-conversation sandboxes, file tree, run logs, and browser research tools

## Run on Windows PowerShell

If PowerShell execution policy blocks `npm` or `pnpm` shim scripts, use the `.cmd` entrypoints directly.

### Install

```powershell
& 'C:\Users\djkim\AppData\Roaming\npm\pnpm.cmd' install
```

Alternative with npm:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' install
```

### Start development

```powershell
& 'C:\Users\djkim\AppData\Roaming\npm\pnpm.cmd' dev
```

### Run tests

```powershell
& 'C:\Users\djkim\AppData\Roaming\npm\pnpm.cmd' test
```

### Build production assets

```powershell
& 'C:\Users\djkim\AppData\Roaming\npm\pnpm.cmd' build
```

### Start the built server

```powershell
& 'C:\Users\djkim\AppData\Roaming\npm\pnpm.cmd' start
```

## Local data

- SQLite DB: `.data/chat.sqlite`
- Encryption key: `.data/secret.key`

## Codex auth import

The app checks:

- `%CODEX_HOME%\auth.json`
- or `%USERPROFILE%\.codex\auth.json`

Only ChatGPT-backed Codex CLI sessions are imported.
