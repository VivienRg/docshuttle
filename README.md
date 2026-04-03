<div align="center">

# DocShuttle

**Turn your Google Drive into a secure, searchable document portal — running entirely on Cloudflare's free tier.**

[![License: DOSNCL](https://img.shields.io/badge/license-DOSNCL%20v1.1-blue?style=flat-square)](./LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Zero Trust](https://img.shields.io/badge/Cloudflare-Zero%20Trust-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://www.cloudflare.com/zero-trust/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Stars](https://img.shields.io/github/stars/VivienRg/docshuttle?style=flat-square)](https://github.com/VivienRg/docshuttle/stargazers)
[![Issues](https://img.shields.io/github/issues/VivienRg/docshuttle?style=flat-square)](https://github.com/VivienRg/docshuttle/issues)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](https://github.com/VivienRg/docshuttle/pulls)

[Quick Start](#quick-start) · [Configuration](#configuration) · [Architecture](#architecture) · [Contributing](#contributing) · [License](#license)

</div>

---

## What is DocShuttle?

DocShuttle is a self-hosted document portal built as a single Cloudflare Worker. It indexes your Google Drive folders and presents them as a clean, fast, searchable web portal — protected by Cloudflare Zero Trust so viewers never need a Google account or Drive access.

Non-technical authors publish documents by uploading them to Google Drive. That's it. No deployment, no configuration changes, no IT ticket.

> **Created and maintained by [Vivien Roggero](https://github.com/VivienRg).**

---

## Features

| | |
|---|---|
| **Zero-Trust Access** | Restrict access by email, identity provider, or device posture via Cloudflare Access — no Drive sharing needed |
| **Multi-Format Rendering** | Google Docs, Sheets, Slides, PDFs, Markdown, plain text, and raw HTML |
| **Nested Folder Tree** | Mirrors your Drive folder hierarchy in a collapsible sidebar |
| **Persistent Cache** | Document metadata and content cached in Cloudflare KV — instant repeat loads |
| **Smart Cache Invalidation** | Version-keyed content cache invalidates automatically when a file changes in Drive |
| **Full-Text Search** | Client-side search across all indexed document names |
| **Shareable Permalinks** | Every document gets a stable `/view/:id` URL |
| **Global Sync** | One click refreshes the index for all users simultaneously |
| **SPA Navigation** | Smooth transitions without full page reloads |
| **Cloudflare Free Tier** | Comfortably fits within free limits for teams of up to ~50 users |

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org) ≥ 18
- A [Cloudflare account](https://cloudflare.com) (free tier)
- A Google account with Drive API access

### 1. Clone and install

```bash
git clone https://github.com/VivienRg/docshuttle.git
cd docshuttle
npm install
```

### 2. Configure

```bash
cp .env.template .env
```

Open `.env` and fill in your values. See [Configuration](#configuration) for details on each variable and [SETUP.md](./SETUP.md) for step-by-step instructions on obtaining Google credentials.

### 3. Generate local config and secrets

```bash
npm run setup
```

This generates `wrangler.toml` from the template and creates `.dev.vars` for local development.

### 4. Deploy

```bash
npm run deploy   # deploy the Worker
npm run secrets  # push Google credentials to Cloudflare
```

Your portal is live. Open the URL printed by Wrangler, click **Refresh** to index your Drive folders, and start reading documents.

---

## Configuration

All configuration lives in `.env`. Copy `.env.template` to get started.

| Variable | Required | Description |
|----------|----------|-------------|
| `WORKER_NAME` | ✅ | Cloudflare Worker name — must be unique within your account |
| `KV_NAMESPACE_ID` | ✅ | KV namespace ID from the Cloudflare dashboard |
| `COMPANY_NAME` | ✅ | Company name shown in the portal footer |
| `PORTAL_TITLE` | ✅ | Title shown in the browser tab and sidebar header |
| `GOOGLE_CLIENT_ID` | ✅ | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | ✅ | Google OAuth 2.0 Client Secret |
| `GOOGLE_REFRESH_TOKEN` | ✅ | OAuth refresh token with `drive.readonly` scope |
| `FOLDER_IDS` | ✅ | Comma-separated Google Drive root folder IDs to index |

### npm scripts

| Script | Description |
|--------|-------------|
| `npm run setup` | Generate `wrangler.toml` and `.dev.vars` from `.env` |
| `npm run secrets` | Push Google credentials and `FOLDER_IDS` to the deployed Worker |
| `npm run dev` | Start a local development server |
| `npm run deploy` | Build and deploy to Cloudflare |

---

## Architecture

```
Browser
  │
  ├─ GET /                 → SPA shell (rendered by Worker, cached at edge)
  ├─ GET /api/docs         → Document index (Cloudflare KV → Google Drive API)
  ├─ GET /api/doc/:id      → File content  (Cloudflare KV → Google Drive API)
  ├─ POST /api/refresh     → Rebuild index (Google Drive API → Cloudflare KV)
  └─ GET /view/:id         → SPA shell with document pre-selected (shareable)
         │
  Cloudflare Worker (your-domain.com)
         │
         ├─ POST https://oauth2.googleapis.com/token     (refresh access token)
         ├─ GET  https://www.googleapis.com/drive/v3/files  (list folders)
         └─ GET  https://www.googleapis.com/drive/v3/files/:id?alt=media
                │
         Google Drive API
```

**Storage:**
- **Cloudflare KV** — document metadata tree (cached, refreshed on demand) and file content (7-day TTL, version-keyed per `modifiedTime`)
- **Google Drive** — source of truth; never written to

**Security:**
- Google credentials stored as Cloudflare Worker secrets (encrypted at rest)
- Viewer authentication handled by Cloudflare Zero Trust — no Google account required for readers
- Drive access is read-only (`drive.readonly` OAuth scope)

---

## Supported File Types

| Format | Rendering |
|--------|-----------|
| Google Docs | Exported as HTML, rendered inline |
| Google Sheets | Exported as HTML, rendered inline |
| Google Slides | Exported as HTML, rendered inline |
| PDF | Embedded PDF viewer |
| Markdown / `.md` | Rendered with marked.js (GitHub-flavoured) |
| Plain text | Rendered with markdown styling |
| Raw HTML | Sandboxed inline iframe |
| Other formats | Opens via Google Drive preview |

---

## Cloudflare Free-Tier Compatibility

DocShuttle is designed to run comfortably within Cloudflare's free tier for small internal teams.

| Resource | Free Limit | Typical Usage (10 users, 5 sessions/day) |
|----------|-----------|------------------------------------------|
| Worker requests | 100,000 / day | ~300 / day ✅ |
| KV reads | 100,000 / day | ~1,000 / day ✅ |
| KV writes | 1,000 / day | ~50 / day ✅ |
| KV storage | 1 GB | Low ✅ |


---

## Contributing

Contributions are welcome. Please open an issue before starting significant work so the approach can be discussed.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes with a clear message
4. Open a pull request against `main`

All pull requests must:
- Not break existing functionality
- Stay within Cloudflare free-tier constraints for the target use case
- Follow the existing code style

[![Open Issues](https://img.shields.io/github/issues/VivienRg/docshuttle?style=flat-square)](https://github.com/VivienRg/docshuttle/issues)
[![Open PRs](https://img.shields.io/github/issues-pr/VivienRg/docshuttle?style=flat-square)](https://github.com/VivienRg/docshuttle/pulls)

---

## License

DocShuttle is released under the **DocShuttle Open Source Non-Commercial License (DOSNCL) v1.1** — free to use and modify for non-commercial purposes, with copyleft and attribution requirements.

Commercial use requires a separate license. Contact the author to discuss terms.

[![License: DOSNCL](https://img.shields.io/badge/license-DOSNCL%20v1.1-blue?style=flat-square)](./LICENSE)

---

<div align="center">
Made by <a href="https://github.com/VivienRg">Vivien Roggero</a>
</div>
