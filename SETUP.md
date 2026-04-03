# DocShuttle — Setup Guide

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![Google Drive API](https://img.shields.io/badge/Google%20Drive-API%20v3-4285F4?style=flat-square&logo=google-drive&logoColor=white)](https://developers.google.com/drive/api/v3/about-sdk)

This guide walks you through a full deployment of DocShuttle from scratch.  
Estimated time: **20–30 minutes** on first setup, **under 5 minutes** for subsequent deployments.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Google OAuth Credentials](#2-google-oauth-credentials)
3. [Cloudflare Setup](#3-cloudflare-setup)
4. [Environment Configuration](#4-environment-configuration)
5. [Deploy](#5-deploy)
6. [Cloudflare Zero Trust](#6-cloudflare-zero-trust)
7. [Publishing Documents](#7-publishing-documents)
8. [Updating and Redeploying](#8-updating-and-redeploying)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org) |
| npm | ≥ 9 | Bundled with Node.js |
| Wrangler CLI | ≥ 3 | Included via `npm install` |
| Cloudflare account | — | [cloudflare.com](https://cloudflare.com) (free tier) |
| Google account | — | Workspace or personal |

Clone the repository and install dependencies:

```bash
git clone https://github.com/VivienRg/docshuttle.git
cd docshuttle
npm install
```

Log in to Cloudflare:

```bash
npx wrangler login
```

---

## 2. Google OAuth Credentials

DocShuttle reads your Drive folders using a long-lived OAuth refresh token. You only need to do this once.

### 2a. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Click **Select a project → New project**
3. Give it a name (e.g. `DocShuttle`) and click **Create**
4. Make sure your new project is selected in the top menu

### 2b. Enable the Google Drive API

1. In the left sidebar: **APIs & Services → Library**
2. Search for **Google Drive API** → click it → click **Enable**

### 2c. Create OAuth 2.0 credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. If prompted, configure the OAuth consent screen first:
   - User type: **Internal** (if using Google Workspace) or **External**
   - Fill in the required app name and contact fields
   - Add the scope `https://www.googleapis.com/auth/drive.readonly`
4. Back on Create Credentials:
   - Application type: **Web application**
   - Name: `DocShuttle`
   - Under **Authorised redirect URIs**, add:  
     `https://developers.google.com/oauthplayground`
5. Click **Create** — note your **Client ID** and **Client Secret**

### 2d. Get a refresh token

1. Open [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
2. Click the ⚙️ gear icon (top right) → enable **"Use your own OAuth credentials"**
3. Enter your **Client ID** and **Client Secret** → close the panel
4. In **Step 1**, scroll to **Drive API v3** and select:  
   `https://www.googleapis.com/auth/drive.readonly`
5. Click **Authorise APIs** and sign in with the Google account that has access to your Drive folders
6. In **Step 2**, click **Exchange authorisation code for tokens**
7. Copy the **Refresh token** — it starts with `1//` and is quite long

> **Important:** The refresh token does not expire unless the OAuth consent screen is set to "Testing" mode. If you set it to "Testing", it expires after 7 days. Publish the app to avoid this.

---

## 3. Cloudflare Setup

### 3a. Create a KV namespace

```bash
npx wrangler kv namespace create CACHE
```

Copy the **id** from the output — you will need it in the next step.

```
🌀 Creating namespace with title "docshuttle-CACHE"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "CACHE", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

### 3b. (Optional) Set a custom domain

If you want a custom domain (e.g. `docs.yourcompany.com`):

1. In the Cloudflare dashboard → **Workers & Pages → your worker → Settings → Domains & Routes**
2. Add your custom domain
3. DNS is configured automatically if the domain is on Cloudflare

---

## 4. Environment Configuration

```bash
cp .env.template .env
```

Open `.env` and fill in all values:

```env
# ── Cloudflare ────────────────────────────────────────────────
WORKER_NAME=docshuttle
KV_NAMESPACE_ID=paste-your-kv-namespace-id-here

# ── Portal branding ───────────────────────────────────────────
COMPANY_NAME=Your Company Name
PORTAL_TITLE=Your Portal Title

# ── Google OAuth secrets ──────────────────────────────────────
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-client-secret
GOOGLE_REFRESH_TOKEN=1//your-refresh-token

# ── Google Drive ──────────────────────────────────────────────
FOLDER_IDS=folder-id-1,folder-id-2
```

### Finding your Google Drive Folder IDs

Open the folder in your browser. The URL looks like:

```
https://drive.google.com/drive/folders/1ABC123xyz_DEF456
                                        ↑ this is the folder ID
```

You can configure **multiple root folders** by separating IDs with commas:

```env
FOLDER_IDS=1ABC123,2DEF456,3GHI789
```

> **Tip:** Create one shared "Team Docs" folder as your root. Authors in other teams can use  
> **Right-click → Organise → Add shortcut** to surface their files in the portal without moving them.

---

## 5. Deploy

### 5a. Generate configuration and deploy

```bash
npm run setup    # generates wrangler.toml and .dev.vars from .env
npm run deploy   # build and deploy the Worker
npm run secrets  # push Google credentials to the live Worker
```

Wrangler will print the deployment URL:

```
Deployed team-hq triggers (0.37 sec)
  https://docshuttle.your-account.workers.dev
```

### 5b. Index your documents

Open the portal URL in your browser, then click the **Refresh** button in the sidebar to index your Google Drive folders. The portal will scan all configured folders and subfolders and cache the document list.

> First load may take 5–15 seconds depending on how many folders you have configured.

### 5c. Verify the deployment

Check that secrets are correctly set on the Worker:

```bash
npx wrangler secret list
```

Expected output:

```json
[
  { "name": "FOLDER_IDS",            "type": "secret_text" },
  { "name": "GOOGLE_CLIENT_ID",      "type": "secret_text" },
  { "name": "GOOGLE_CLIENT_SECRET",  "type": "secret_text" },
  { "name": "GOOGLE_REFRESH_TOKEN",  "type": "secret_text" }
]
```

---

## 6. Cloudflare Zero Trust

Restrict portal access to your team without requiring Google Drive permissions.  
Cloudflare Access is **free for up to 50 users**.

### 6a. Create an Access application

1. Go to [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Access → Applications**
2. Click **Add an application → Self-hosted**
3. Fill in:
   - **Application name:** DocShuttle (or your portal name)
   - **Session duration:** 24 hours (or your preference)
   - **Application domain:** your Worker domain (e.g. `docs.yourcompany.com`)

### 6b. Configure an access policy

4. Click **Next → Add a policy**
5. Policy name: `Team Access`
6. Action: **Allow**
7. Under **Include**, choose one or more rules:
   - **Emails ending in:** `@yourcompany.com`
   - **Email:** list specific addresses
   - **Identity provider:** Google Workspace, Okta, etc.
8. Click **Next → Add application**

Users outside your policy will see a Cloudflare Access login page instead of the portal.

---

## 7. Publishing Documents

This is what your non-technical authors do every time they want to share a document:

| Format | How to publish |
|--------|---------------|
| Google Doc / Sheet / Slide | Move or add a shortcut to a configured Drive folder |
| PDF | Upload to a configured Drive folder |
| Markdown (`.md`) | Upload to a configured Drive folder |
| HTML (`.html`) | Upload to a configured Drive folder |

After uploading, a team admin clicks **Refresh** in the portal sidebar.  
The document appears in the portal within seconds.

> **Shortcuts:** Authors can keep files in their own Drive folders and add shortcuts to the configured portal folder. Right-click the file → **Organise → Add shortcut to Drive** → select the portal folder. The portal resolves shortcuts automatically.

---

## 8. Updating and Redeploying

When you update the Worker code or configuration:

```bash
# If you changed .env or wrangler.toml.template:
npm run setup

# Redeploy the Worker:
npm run deploy

# If you changed Google credentials or FOLDER_IDS:
npm run secrets
```

To update the document index without redeploying:

- Click the **Refresh** button in the portal sidebar (updates for all users instantly)

---

## 9. Troubleshooting

### Portal shows only a "Root" folder with no documents

The most common cause is missing or invalid Worker secrets.

```bash
npx wrangler secret list   # verify all 4 secrets are present
npm run secrets            # re-push secrets from .env if any are missing
```

After re-pushing secrets, click **Refresh** in the portal.

### Refresh button does nothing / spins forever

Open the browser developer console (F12) and check the Network tab for the `/api/refresh` response. A `500` response indicates a server-side error — usually a bad Google credential.

Verify your credentials by testing the OAuth token refresh manually:

```bash
source <(grep -E '^GOOGLE_' .env)
curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=$GOOGLE_CLIENT_ID&client_secret=$GOOGLE_CLIENT_SECRET&refresh_token=$GOOGLE_REFRESH_TOKEN&grant_type=refresh_token"
```

If the response contains `"error": "invalid_grant"`, your refresh token has expired. Return to [Step 2d](#2d-get-a-refresh-token) to generate a new one.

### Documents load as blank / empty iframe

This is usually a content type or export issue. Check:
- The file is in a supported format (see [README.md → Supported File Types](./README.md#supported-file-types))
- The Google account used for OAuth has read access to the file
- The file is not in Trash in Google Drive

### Deployed to the wrong Worker name

If you deployed under the wrong `WORKER_NAME`, secrets are tied to that Worker and do not carry over automatically when you rename.

```bash
# After correcting WORKER_NAME in .env:
npm run setup    # regenerates wrangler.toml with the new name
npm run deploy   # creates/updates the correctly named Worker
npm run secrets  # pushes secrets to the new Worker name
```

### Local development

```bash
npm run setup   # generates .dev.vars for wrangler dev
npm run dev     # starts a local Worker on http://localhost:8787
```

Wrangler reads `wrangler.toml` for vars and `.dev.vars` for secrets automatically.

---

<div align="center">

**Need help?** Open an issue at [github.com/VivienRg/docshuttle/issues](https://github.com/VivienRg/docshuttle/issues)

</div>
