// ============================================================
// Google Drive HTML Docs Portal — Cloudflare Worker
// ============================================================

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CACHE_KEY_METADATA = "doc_portal_tree_v6";
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_BYTES = 256 * 1024; // 256 KB

let subrequestCount = 0;

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(base64);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// ── Google Auth ────────────────────────────────────────────

async function getAccessToken(env) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('Missing GOOGLE_* secrets.');
  }
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  });
  const res = await fetch(TOKEN_URL, { method: 'POST', body });
  const json = await res.json();
  if (!json.access_token) throw new Error('Drive auth failed.');
  return json.access_token;
}

// ── Drive helpers ──────────────────────────────────────────

async function listFilesInFolder(token, folderId, folderName = '') {
  if (subrequestCount > 40) return { files: [], subfolders: [] };
  subrequestCount++;
  const q = `'${folderId}' in parents and trashed = false`;
  const fields = 'files(id,name,mimeType,modifiedTime,shortcutDetails,description,webViewLink)';
  const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=${fields}&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (data.error) throw new Error(`Drive API Error [list]: ${data.error.message}`);
  const items = data.files || [];
  const results = { files: [], subfolders: [] };

  for (const item of items) {
    const isShortcut = item.mimeType === 'application/vnd.google-apps.shortcut';
    const mimeType = isShortcut ? item.shortcutDetails?.targetMimeType : item.mimeType;
    const id = isShortcut ? item.shortcutDetails?.targetId : item.id;
    if (!id) continue;

    if (mimeType === 'application/vnd.google-apps.folder') {
      results.subfolders.push({ id, name: item.name, parentFolderId: folderId });
    } else {
      let driveExport = null;
      let useViewer = false;
      const lowerName = item.name.toLowerCase();

      if (mimeType === 'application/vnd.google-apps.document' ||
        mimeType === 'application/vnd.google-apps.spreadsheet' ||
        mimeType === 'application/vnd.google-apps.presentation') {
        driveExport = 'text/html';
      }
      else if (mimeType === 'text/html' ||
        mimeType === 'text/markdown' ||
        mimeType === 'text/plain' ||
        mimeType === 'application/pdf' ||
        lowerName.endsWith('.html') ||
        lowerName.endsWith('.htm') ||
        lowerName.endsWith('.md') ||
        lowerName.endsWith('.markdown') ||
        lowerName.endsWith('.txt')) {
      }
      else {
        useViewer = true;
      }

      results.files.push({
        id, name: stripExt(item.name), description: item.description || '',
        modifiedTime: item.modifiedTime, folder: folderName, parentFolderId: folderId,
        mimeType, driveExport, useViewer, webViewLink: item.webViewLink
      });
    }
  }
  return results;
}

async function buildDocList(env) {
  subrequestCount = 0;
  const token = await getAccessToken(env);
  const folderIds = (env.FOLDER_IDS || "").split(',').map(s => s.trim()).filter(Boolean);
  if (folderIds.length === 0) throw new Error('FOLDER_IDS is empty.');
  const seen = new Set();
  const docs = [];
  const folders = [];

  async function processFolder(folderId, folderName, depth = 0) {
    if (depth > 8 || subrequestCount > 45) return;
    const results = await listFilesInFolder(token, folderId, folderName);
    for (const file of results.files) {
      if (!seen.has(file.id)) { seen.add(file.id); docs.push(file); }
    }
    for (const subfolder of results.subfolders) {
      if (seen.has(subfolder.id)) continue;
      seen.add(subfolder.id);
      folders.push({ id: subfolder.id, name: subfolder.name, parentFolderId: folderId });
      await processFolder(subfolder.id, subfolder.name, depth + 1);
    }
  }

  await Promise.all(folderIds.map(async (folderId) => {
    try {
      const url = `${DRIVE_API}/files/${folderId}?fields=id,name&supportsAllDrives=true`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const meta = await res.json();
      if (meta.error) {
        throw new Error(`Drive API Error [meta]: ${meta.error.message} (Folder: ${folderId})`);
      }
      const folderName = meta.name || 'Root';
      folders.push({ id: folderId, name: folderName, parentFolderId: null, isRoot: true });
      await processFolder(folderId, folderName);
    } catch (e) {
      console.error(`Error processing root folder ${folderId}:`, e.message);
      throw e;
    }
  }));
  docs.sort((a, b) => a.name.localeCompare(b.name));
  return { docs, folders, updated: Date.now() };
}

function stripExt(name = '') { return name.replace(/\.(html?|markdown|md|pdf|docx?|txt|xlsx?|pptx?)$/i, ''); }

function rewriteHtmlLinks(html, docs) {
  const docMap = new Map();
  docs.forEach(d => { docMap.set(d.name.toLowerCase(), d.id); docMap.set(d.id, d.id); });
  const result = html.replace(/(?:href|src)=["']([^"']+)["']/gi, (match, url) => {
    if (url.startsWith('data:') || url.startsWith('mailto:') || url.startsWith('#')) return match;
    const driveMatch = url.match(/(?:drive\.google\.com\/[^/]+\/d\/|docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/)([A-Za-z0-9_-]+)/);
    const id = driveMatch ? docMap.get(driveMatch[1]) : docMap.get(url.split('/').pop().replace(/\.(html?|pdf|md|docx?|txt|xlsx?|pptx?)$/i, '').toLowerCase());
    if (id) return match.toLowerCase().startsWith('href') ? match.replace(url, '#').replace(/href=/i, `data-doc-id="${id}" href=`) : match.replace(url, '/api/doc/' + id);
    return match;
  });
  const spa = `<script>document.addEventListener('click',e=>{const l=e.target.closest('a');if(l){const id=l.getAttribute('data-doc-id');if(id){e.preventDefault();window.parent.postMessage({type:'NAVIGATE',id},'*')}else if(l.href.includes('/view/')){const m=l.href.match(/\\/view\\/([A-Za-z0-9_-]+)/);if(m){e.preventDefault();window.parent.postMessage({type:'NAVIGATE',id:m[1]},'*')}}}});</script>`;
  return result.includes('</body>') ? result.replace('</body>', spa + '</body>') : result + spa;
}

// ── Main handler ───────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/favicon.ico' || path === '/favicon.png') {
      return env.ASSETS.fetch(request);
    }

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (path === '/' || path.startsWith('/view/')) {
      const jwtToken = request.headers.get('Cf-Access-Jwt-Assertion') || '';
      const jwtClaims = decodeJwtPayload(jwtToken);
      return new Response(getPortalHtml(env, jwtClaims), {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
          'Cache-Control': 'public, max-age=60' // 1 minute
        }
      });
    }

    // API: List Docs (Pulling from metadata cache)
    if (path === '/api/docs') {
      try {
        let data = env.CACHE ? await env.CACHE.get(CACHE_KEY_METADATA, 'json') : null;
        if (!data) {
          data = await buildDocList(env);
          if (env.CACHE) await env.CACHE.put(CACHE_KEY_METADATA, JSON.stringify(data));
        }
        return new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300', // 5 minutes
            ...CORS
          }
        });
      } catch (e) { return json({ error: e.message }, 500); }
    }

    // API: Global Refresh
    if (path === '/api/refresh' && request.method === 'POST') {
      try {
        if (env.CACHE) {
          const lastRefresh = await env.CACHE.get('last_refresh_ts');
          if (lastRefresh && Date.now() - Number(lastRefresh) < REFRESH_COOLDOWN_MS) {
            const remaining = Math.ceil((REFRESH_COOLDOWN_MS - (Date.now() - Number(lastRefresh))) / 1000);
            return json({ error: `Refresh cooldown active. Try again in ${remaining}s.` }, 429);
          }
          await env.CACHE.put('last_refresh_ts', String(Date.now()));
        }

        const data = await buildDocList(env);
        if (env.CACHE) await env.CACHE.put(CACHE_KEY_METADATA, JSON.stringify(data));
        return json({ success: true, updated: data.updated });
      } catch (e) { return json({ error: e.message }, 500); }
    }

    // API: Clear Cache (Refresh KV + Purge Cloudflare Edge Cache)
    if (path === '/api/clear-cache' && request.method === 'POST') {
      try {
        if (env.CACHE) {
          const lastRefresh = await env.CACHE.get('last_refresh_ts');
          if (lastRefresh && Date.now() - Number(lastRefresh) < REFRESH_COOLDOWN_MS) {
            const remaining = Math.ceil((REFRESH_COOLDOWN_MS - (Date.now() - Number(lastRefresh))) / 1000);
            return json({ error: `Cooldown active. Try again in ${remaining}s.` }, 429);
          }
          await env.CACHE.put('last_refresh_ts', String(Date.now()));
        }

        const data = await buildDocList(env);
        if (env.CACHE) await env.CACHE.put(CACHE_KEY_METADATA, JSON.stringify(data));

        // Purge Cloudflare edge cache for all doc URLs
        const cfCache = caches.default;
        const origin = new URL(request.url).origin;
        await Promise.allSettled(data.docs.map(doc =>
          cfCache.delete(new Request(`${origin}/api/doc/${doc.id}`))
        ));

        return json({ success: true, updated: data.updated, purged: data.docs.length });
      } catch (e) { return json({ error: e.message }, 500); }
    }

    // API: Fetch Doc Content (Optimized with Versioned Cache)
    const docMatch = path.match(/^\/api\/doc\/([A-Za-z0-9_-]+)$/);
    if (docMatch) {
      try {
        const fileId = docMatch[1];
        const list = env.CACHE ? await env.CACHE.get(CACHE_KEY_METADATA, 'json') : await buildDocList(env);
        const doc = list.docs.find(d => d.id === fileId);
        if (!doc) return new Response('Not found', { status: 404 });
        if (doc.useViewer) return new Response('Use Viewer.', { status: 400 });

        // Generate a version-specific cache key for content
        // This key changes if the file is modified in Drive OR if the repository is globally refreshed (updated timestamp)
        const CONTENT_CACHE_KEY = `content:${fileId}:${doc.modifiedTime}:${list.updated}`;

        if (env.CACHE) {
          const cached = await env.CACHE.get(CONTENT_CACHE_KEY, 'arrayBuffer');
          if (cached) {
            const type = doc.mimeType === 'application/pdf' ? 'application/pdf' : 'text/html;charset=UTF-8';
            return new Response(cached, {
              headers: {
                ...CORS,
                'Content-Type': type,
                'X-Cache': 'HIT',
                'Cache-Control': 'public, max-age=31536000, immutable'
              }
            });
          }
        }

        // Cache Miss -> Fetch from Google Drive
        const token = await getAccessToken(env);
        const driveUrl = doc.driveExport ? `${DRIVE_API}/files/${fileId}/export?mimeType=text/html&supportsAllDrives=true` : `${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`;

        const res = await fetch(driveUrl, {
          headers: { Authorization: `Bearer ${token}` },
          cf: { cacheTtl: 0 }
        });

        if (!res.ok) throw new Error(`Drive API Error: ${res.status}`);

        let finalBuffer;
        if (doc.mimeType === 'application/pdf') {
          finalBuffer = await res.arrayBuffer();
        } else {
          let content = await res.text();
          const lowerName = doc.name.toLowerCase();
          const isMd = doc.mimeType === 'text/markdown' || lowerName.endsWith('.md') || lowerName.endsWith('.markdown');
          const isTxt = doc.mimeType === 'text/plain' || lowerName.endsWith('.txt');

          if (isMd || isTxt) {
            content = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.5.1/github-markdown.min.css">
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <style>
    body { box-sizing: border-box; min-width: 200px; max-width: 980px; margin: 0 auto; padding: 45px; background: #fff; }
    @media (max-width: 767px) { body { padding: 15px; } }
    .raw { font-family: monospace !important; white-space: pre !important; background: #f6f8fa !important; padding: 16px !important; border-radius: 6px; overflow: auto; font-size: 13px; line-height: 1.45; }
  </style></head><body class="markdown-body"><div id="content"></div>
  <script id="raw-data" type="text/markdown">${content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</script>
  <script>(function(){
    const md = document.getElementById('raw-data').textContent;
    const mode = (new URLSearchParams(window.location.search)).get('mode') || 'rendered';
    const container = document.getElementById('content');
    if (mode === 'raw') { container.className = 'raw'; container.textContent = md; }
    else { container.innerHTML = marked.parse(md); }
  })();</script></body></html>`;
          }
          const html = rewriteHtmlLinks(content, list.docs);
          finalBuffer = new TextEncoder().encode(html);
        }

        // Store content in KV with 7-day TTL if below size threshold
        if (env.CACHE && finalBuffer.byteLength <= MAX_CACHE_BYTES) {
          await env.CACHE.put(CONTENT_CACHE_KEY, finalBuffer, { expirationTtl: 604800 });
        }

        const type = doc.mimeType === 'application/pdf' ? 'application/pdf' : 'text/html;charset=UTF-8';
        return new Response(finalBuffer, {
          headers: {
            ...CORS,
            'Content-Type': type,
            'X-Cache': 'MISS',
            'Cache-Control': 'public, max-age=31536000, immutable'
          }
        });
      } catch (e) { return new Response(e.message, { status: 500 }); }
    }
    return new Response('Not found', { status: 404 });
  }
};

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
function json(d, status = 200) { return new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', ...CORS } }); }

function getPortalHtml(env, user = null) {
  const companyName = env.COMPANY_NAME || 'DocShuttle';
  const portalTitle = env.PORTAL_TITLE || 'DocShuttle';
  const portalVersion = env.PORTAL_VERSION || '1.3.2';
  const userJson = user ? JSON.stringify({ email: user.email, sub: user.sub, iat: user.iat }) : 'null';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${portalTitle}</title>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" href="/favicon.png">
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,700&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#f7f6f2;
  --surf:#ffffff;
  --text:#28251d;
  --prim:#01696f;
  --hl:#cedcd8;
  --border:#d4d1ca;
  --muted:#7a7974;

  /* Sidebar Colors (Light Theme version of Documentation style) */
  --sidebar-bg: var(--surf);
  --sidebar-hover: #f3f0ec;
  --sidebar-active: #f3f0ec;
  --sidebar-border: var(--border);
  --sidebar-text: var(--text);
  --sidebar-active-text: var(--prim);
  --sidebar-label: var(--muted);
}

*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Satoshi',sans-serif;background:var(--bg);color:var(--text);height:100vh;display:flex;flex-direction:column;overflow:hidden}

.topbar{display:flex;align-items:center;padding:0 1.5rem;height:56px;background:var(--surf);box-shadow: 0 1px 3px rgba(0,0,0,0.06);gap:1rem;z-index:20}
.logo-container{display:flex;align-items:center;gap:0.75rem;text-decoration:none;color:var(--text);flex-shrink:0}
.logo-svg{width:32px;height:32px}
.logo-text{font-weight:700;font-size:1.1rem;letter-spacing:-0.02em}

.search-wrap{margin-left:auto;width:100%;max-width:320px;position:relative}
#search{width:100%;height:34px;padding:0 1rem;border-radius:17px;border:1px solid var(--border);background:#f3f0ec;font-family:inherit;font-size:14px}
#search:focus{outline:none;border-color:var(--prim);background:#fff}

.body{display:flex;flex:1;overflow:hidden}
.sidebar{width:260px;background:var(--sidebar-bg);border-right:1px solid var(--sidebar-border);display:flex;flex-direction:column;transition:width 0.3s cubic-bezier(0.4, 0, 0.2, 1);overflow:hidden;z-index:50}
.sidebar.collapsed{width:0;border-right:none}
.sidebar-content{width:260px;height:100%;display:flex;flex-direction:column;flex-shrink:0}

.tree-container{flex:1;overflow-y:auto;padding:1rem 0}
.tree-container::-webkit-scrollbar{width:4px}
.tree-container::-webkit-scrollbar-track{background:transparent}
.tree-container::-webkit-scrollbar-thumb{background:var(--sidebar-border);border-radius:4px}

/* Hierarchy Styling */
.nav-group-label{padding:1.5rem 1.5rem 0.5rem;font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--sidebar-label)}
.root-divider { height: 1px; background: var(--sidebar-border); margin: 0 1.5rem 0.5rem; }

.doc-item{display:flex;align-items:center;gap:0.6rem;padding:0.55rem 1.5rem;color:var(--sidebar-text);text-decoration:none;font-size:0.82rem;font-weight:500;transition:background 0.15s, color 0.15s;position:relative;cursor:pointer;border:none;background:transparent;width:100%;text-align:left}
.doc-item:hover{background:var(--sidebar-hover);color:var(--prim)}
.doc-item.active{background:var(--sidebar-active);color:var(--sidebar-active-text);font-weight:700}
.doc-item.active::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--prim);border-radius:0 3px 3px 0}

.folder-header{padding:0.55rem 1.5rem;cursor:pointer;font-weight:700;font-size:0.82rem;display:flex;align-items:center;gap:8px;user-select:none;color:var(--sidebar-text);transition: color 0.15s}
.folder-header:hover{color:var(--prim)}

/* Nested level styling */
.folder-children{display:none;margin-left:1.5rem; border-left: 1px solid var(--sidebar-border); }
.folder-children.open{display:block}
.folder-children .doc-item, .folder-children .folder-header { padding-left: 1rem; }

.sidebar-settings{margin-top:auto;padding:0.5rem 0;border-top:1px solid var(--sidebar-border)}
  .sidebar-settings .doc-item{padding:0.55rem 1.5rem}
  .settings-content.open{display:block !important}
  .sidebar-footer{padding:1rem 1.5rem;border-top:1px solid var(--sidebar-border);font-size:10px;color:var(--sidebar-label);line-height:1.4}
.badge-version{display:inline-block;background:var(--prim);color:#fff;font-size:0.62rem;font-weight:700;padding:2px 7px;border-radius:20px;letter-spacing:0.03em}

@media (max-width: 970px) {
  .search-wrap { display: none; }
  .search-btn { display: flex !important; }
}
@media (max-width: 620px) {
  .body { flex-direction: column; }
  .sidebar { position: fixed; left: 0; top: 56px; bottom: 0; width: 280px; transform: translateX(-100%); }
  .sidebar.open { transform: translateX(0); }
  .viewer { width: 100%; }
  .topbar { padding: 0 1rem; }
  .logo-text { display: none; }
}
@media (max-width: 480px) {
  .viewer-topbar { flex-wrap: wrap; height: auto; padding: 0.5rem; gap: 0.5rem; }
}

.viewer{flex:1;display:flex;flex-direction:column;position:relative;background:var(--bg)}
.viewer-topbar{height:48px;padding:0 1rem;display:flex;align-items:center;justify-content:space-between;background:var(--surf);border-bottom:1px solid var(--border)}

.btn{padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:#fff;cursor:pointer;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;text-decoration:none;color:inherit}
.btn:hover{background:#f9f8f4}
.btn-toggle{padding:8px;border:none;background:transparent;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center}
.btn-toggle:hover{background:var(--hl)}
.btn-prim{background:var(--prim);color:#fff !important;border:none}
.btn-group{display:flex;background:#f3f0ec;padding:2px;border-radius:8px;margin-right:12px}
.btn-group .btn-item{padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:none;background:transparent;color:var(--muted)}
.btn-group .btn-item.active{background:#fff;color:var(--prim);box-shadow:0 2px 4px rgba(0,0,0,0.05)}

.refresh-overlay{position:fixed;inset:0;background:rgba(255,255,255,0.9);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:200;text-align:center}
.viewer-overlay{position:absolute;inset:0;background:rgba(255,255,255,0.9);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:10;text-align:center}
.loading-logo{width:64px;height:64px;background:url('/favicon.png') no-repeat center;background-size:contain;animation:spin 2s linear infinite;margin-bottom:1rem}
@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}

.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);display:none;align-items:center;justify-content:center;z-index:100}
.modal{background:#fff;padding:1.5rem;border-radius:12px;width:100%;max-width:320px;box-shadow:0 10px 25px rgba(0,0,0,0.1);text-align:center}
.modal-btns{display:flex;gap:0.75rem;justify-content:center;margin-top:1.5rem}

.user-menu{padding:0.75rem 1rem;border-top:1px solid var(--sidebar-border);display:flex;align-items:center;gap:0.75rem}
.user-avatar{width:32px;height:32px;border-radius:50%;background:var(--prim);color:#fff;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.user-info{display:flex;flex-direction:column;overflow:hidden}
.user-name{font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.user-email{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.user-login{font-size:10px;color:var(--sidebar-label);opacity:0.7;margin-top:2px}

.dashboard{flex:1;overflow-y:auto;padding:2rem;background:var(--bg)}
.dash-grid{display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:1rem;margin-bottom:2rem}
.dash-card{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:1.25rem 1.5rem}
.dash-card-label{font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase;margin-bottom:0.5rem}
.dash-card-value{font-size:1.5rem;font-weight:700;color:var(--text);line-height:1.2}
.dash-card-sub{font-size:12px;color:var(--muted);margin-top:4px}
.dash-section-label{font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--muted);text-transform:uppercase;margin-bottom:0.75rem}
.dash-table-wrap{background:var(--surf);border:1px solid var(--border);border-radius:12px;padding:1.25rem 1.5rem}
.dash-table{width:100%;border-collapse:collapse;font-size:13px}
.dash-table th{text-align:left;font-size:10px;font-weight:700;letter-spacing:0.06em;color:var(--muted);text-transform:uppercase;padding:0 0 0.75rem;border-bottom:1px solid var(--border)}
.dash-table td{padding:0.6rem 0;border-bottom:1px solid var(--border);color:var(--text)}
.dash-table tr:last-child td{border-bottom:none}
.dash-table .doc-link{color:var(--prim);font-weight:600;cursor:pointer;background:none;border:none;font-family:inherit;font-size:inherit;padding:0;text-align:left}
.dash-table .doc-link:hover{text-decoration:underline}

iframe{flex:1;border:none;background:#fff;transition:opacity 0.2s}
</style>
</head>
<body>
  <div class="refresh-overlay" id="refresh-overlay">
    <div class="loading-logo"></div>
    <h2 id="overlay-title" style="color:var(--prim)">Refreshing, please wait...</h2>
    <p id="overlay-desc" style="font-size:13px;color:var(--muted);margin-top:8px">Updating the global repository cache.</p>
  </div>

  <div class="modal-overlay" id="modal">
    <div class="modal">
      <h3 id="modal-title">Refresh Repository?</h3>
      <p id="modal-desc" style="font-size:13px;color:var(--muted);margin-top:8px">Be sure you have added documents to Google Drive before refreshing. This will update the library for all users.</p>
      <div class="modal-btns">
        <button class="btn" id="modal-cancel">Cancel</button>
        <button class="btn btn-prim" id="modal-confirm">Refresh Now</button>
      </div>
    </div>
  </div>

  <header class="topbar">
    <button class="btn-toggle" id="menu-toggle"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
    <a href="/" class="logo-container" id="logo-link">
      <svg class="logo-svg" viewBox="0 0 1024.8 1024.8"><polygon points="427.6 128.78 968.15 128.78 750.93 506.41 633.13 506.41 810.25 219.01 488.59 219.85 427.6 128.78" style="fill:#5b616e;"/><polygon points="56.65 234.05 427.6 234.05 490.26 335.98 116.8 335.98 56.65 234.05" style="fill:#5b616e;"/><polygon points="599.5 285.01 407.5 590.97 267.19 370.23 142.7 370.23 403.37 780.45 719.39 284.98 599.5 285.01" style="fill:#f59e0b;"/><polygon points="612.24 544.84 442.64 830.58 498.61 919.97 728.37 544.84 612.24 544.84" style="fill:#5b616e;"/></svg>
      <span class="logo-text">${portalTitle}</span>
    </a>
    <div class="search-wrap"><input id="search" placeholder="Search documents..."></div>
    <button class="btn-toggle search-btn" id="search-btn" style="display:none" onclick="document.getElementById('search-modal').style.display='flex'">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
    </button>
    <div id="search-modal" style="display:none;position:fixed;inset:0;background:#fff;z-index:100;flex-direction:column;align-items:center;padding:2rem">
      <div style="width:100%;max-width:400px">
        <button onclick="document.getElementById('search-modal').style.display='none'" style="margin-bottom:1rem;padding:4px 8px;border:1px solid var(--border);background:#fff;border-radius:4px;cursor:pointer">Close</button>
        <input id="search-mobile" placeholder="Search documents..." style="width:100%;height:40px;padding:0 1rem;border-radius:8px;border:1px solid var(--border);font-size:16px">
      </div>
    </div>
</header>

  <div class="body">
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-content">
        <nav class="tree-container" id="tree">
          <div class="nav-group-label">OVERVIEW</div>
          <button class="doc-item" id="dashboard-link">
            <svg class="nav-item-icon" style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Dashboard
          </button>
          <button class="doc-item" id="docs-link">
            <svg class="nav-item-icon" style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Documentation
          </button>
          <div id="tree-content"></div>
        </nav>

        <div class="sidebar-settings" id="sidebar-settings">
          <div class="nav-group-label" style="cursor:pointer" onclick="document.getElementById('settings-content').classList.toggle('open')">
            SETTINGS <span style="float:right">▼</span>
          </div>
          <div class="settings-content" id="settings-content" style="display:none">
            <button class="doc-item" id="btn-refresh">
              <svg class="nav-item-icon" style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>
              Refresh
            </button>
            <button class="doc-item" id="btn-clear-cache">
              <svg class="nav-item-icon" style="width:16px;height:16px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              Clear Cache
            </button>
          </div>
        </div>

        <div class="user-menu" id="user-menu" style="display:none">
          <div class="user-avatar" id="user-avatar"></div>
          <div class="user-info">
            <span class="user-name" id="user-name"></span>
            <span class="user-email" id="user-email"></span>
            <span class="user-login" id="user-login"></span>
          </div>
        </div>

        <div class="sidebar-footer">
          <div style="margin-bottom: 8px; opacity: 0.8;">
            <div style="display: flex; justify-content: space-between; font-size: 9px; margin-bottom: 2px;">
              <span>VERSION</span>
              <span class="badge-version" style="padding: 1px 5px;">v${portalVersion}</span>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 9px;">
              <span>LAST UPDATE</span>
              <span id="side-last-update" style="color: var(--sidebar-text); font-weight: 600;">—</span>
            </div>
          </div>
          <p style="margin-bottom:4px"><strong>Confidential Internal Use Only</strong></p>
          <p>&copy; <span id="copy-year"></span> ${companyName}</p>
        </div>
      </div>
    </aside>

    <main class="viewer">
      <div id="dashboard" class="dashboard">
        <div class="dash-grid">
          <div class="dash-card">
            <div class="dash-card-label">Signed in as</div>
            <div class="dash-card-value" id="dash-user-name">—</div>
            <div class="dash-card-sub" id="dash-user-email"></div>
            <div class="dash-card-sub" id="dash-user-login"></div>
          </div>
          <div class="dash-card">
            <div class="dash-card-label">Repository last refreshed</div>
            <div class="dash-card-value" id="dash-refresh-time">—</div>
            <div class="dash-card-sub" id="dash-refresh-sub"></div>
          </div>
          <div class="dash-card">
            <div class="dash-card-label">Total documents</div>
            <div class="dash-card-value" id="dash-total-files">—</div>
            <div class="dash-card-sub" id="dash-total-sub"></div>
          </div>
        </div>
        <div class="dash-table-wrap">
          <div class="dash-section-label">Recently updated</div>
          <table class="dash-table">
            <thead>
              <tr><th>Document</th><th>Folder</th><th>Last modified</th></tr>
            </thead>
            <tbody id="dash-recent-body"></tbody>
          </table>
        </div>
      </div>

      <div id="v-top" class="viewer-topbar" style="display:none">
        <span id="v-title" style="font-weight:700;font-size:14px"></span>
        <div style="display:flex;align-items:center">
          <div id="md-toggle" class="btn-group" style="display:none">
            <button class="btn-item active" id="btn-render">Rendered</button>
            <button class="btn-item" id="btn-raw">Raw</button>
          </div>
          <a class="btn btn-prim" id="drive-link" target="_blank">Open in Drive</a>
        </div>
      </div>
      <div class="viewer-overlay" id="viewer-overlay">
        <div class="loading-logo"></div>
        <div style="font-size:14px;font-weight:600;color:var(--prim)">Loading document...</div>
      </div>
      <iframe id="frame" style="display:none"></iframe>
    </main>
  </div>
<script>
(function(){
  const CURRENT_USER = ${userJson};
  let docs=[], folders=[], activeId=null, openIds=new Set(), mdMode='rendered', lastUpdated=null, cacheVersion=null, pendingAction=null;
  const treeEl=document.getElementById('tree-content'), frame=document.getElementById('frame'), sidebar=document.getElementById('sidebar'), modal=document.getElementById('modal'), driveLink=document.getElementById('drive-link');
  const refreshOverlay=document.getElementById('refresh-overlay'), viewerOverlay=document.getElementById('viewer-overlay'), dashboard=document.getElementById('dashboard');

  document.getElementById('copy-year').textContent = new Date().getFullYear();

  function displayName(email) {
    if (!email) return 'Unknown';
    const local = email.split('@')[0];
    return local.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
  }

  async function load(){
    const res = await fetch('/api/docs');
    const data = await res.json();
    if(data.error) { treeEl.innerHTML = '<div style="padding:1rem;color:red">'+data.error+'</div>'; return; }
    docs=data.docs||[]; folders=data.folders||[]; lastUpdated=data.updated||null;
    
    if (data.updated) {
      const d = new Date(data.updated);
      document.getElementById('side-last-update').textContent = d.toLocaleDateString();
    }
    
    render();
    
    const m=location.pathname.match(/^\\/view\\/([A-Za-z0-9_-]+)/);
    if(m) openDoc(m[1]);
    else showDashboard();

    if (CURRENT_USER) {
      const name = displayName(CURRENT_USER.email);
      const loginDate = new Date(CURRENT_USER.iat * 1000);
      const loginStr = loginDate.toLocaleDateString() + ' ' + loginDate.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
      document.getElementById('user-name').textContent = name;
      document.getElementById('user-email').textContent = CURRENT_USER.email;
      document.getElementById('user-login').textContent = 'Last login: ' + loginStr;
      document.getElementById('user-avatar').textContent = name.charAt(0).toUpperCase();
      document.getElementById('user-menu').style.display = 'flex';
    }
  }

  function showDashboard() {
    document.getElementById('v-top').style.display = 'none';
    dashboard.style.display = 'block';
    frame.style.display = 'none';
    activeId = null;
    document.getElementById('dashboard-link').classList.add('active');
    render();
    history.pushState(null, '', '/');

    if (CURRENT_USER) {
      const name = displayName(CURRENT_USER.email);
      const loginDate = new Date(CURRENT_USER.iat * 1000);
      document.getElementById('dash-user-name').textContent = name;
      document.getElementById('dash-user-email').textContent = CURRENT_USER.email;
      document.getElementById('dash-user-login').textContent = 'Last login: ' + loginDate.toLocaleDateString() + ' ' + loginDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    if (lastUpdated) {
      const d = new Date(lastUpdated);
      document.getElementById('dash-refresh-time').textContent = d.toLocaleDateString();
      document.getElementById('dash-refresh-sub').textContent = 'at ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    document.getElementById('dash-total-files').textContent = docs.length;
    const folderCount = folders.filter(f => !f.isRoot).length;
    document.getElementById('dash-total-sub').textContent = \`across \${folderCount} folder\${folderCount !== 1 ? 's' : ''}\`;

    const recent = [...docs].sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime)).slice(0, 10);
    const tbody = document.getElementById('dash-recent-body');
    tbody.innerHTML = recent.map(doc => {
      const folder = folders.find(f => f.id === doc.parentFolderId);
      const modified = new Date(doc.modifiedTime);
      const modStr = modified.toLocaleDateString() + ' ' + modified.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return \`<tr>
        <td><button class="doc-link" onclick="openDoc('\${doc.id}')">\${doc.name}</button></td>
        <td style="color:var(--muted)">\${folder ? folder.name : '—'}</td>
        <td style="color:var(--muted)">\${modStr}</td>
      </tr>\`;
    }).join('');
  }

  function render(){
    const search=document.getElementById('search').value.toLowerCase();
    if(search){
      treeEl.innerHTML = docs.filter(d=>d.name.toLowerCase().includes(search)).map(d=>\`<button class="doc-item \${d.id===activeId?'active':''}" onclick="openDoc('\${d.id}')">\${d.name}</button>\`).join('');
    } else {
      const map = new Map();
      folders.forEach(f=>map.set(f.id,{...f,children:[],files:[]}));
      folders.forEach(f=>{if(f.parentFolderId&&map.has(f.parentFolderId)) map.get(f.parentFolderId).children.push(map.get(f.id))});
      docs.forEach(d=>{if(d.parentFolderId&&map.has(d.parentFolderId)) map.get(d.parentFolderId).files.push(d)});
      const roots = folders.filter(f=>f.isRoot||!f.parentFolderId).map(f=>map.get(f.id));
      
      treeEl.innerHTML = roots.map(r => {
        return \`
          <div class="root-section">
            <div class="nav-group-label">\${r.name}</div>
            <div class="root-children">
              \${r.children.map(c => renderNode(c)).join('')}
              \${r.files.map(f => \`<button class="doc-item \${f.id===activeId?'active':''}" onclick="openDoc('\${f.id}')">\${f.name}</button>\`).join('')}
            </div>
          </div>
        \`;
      }).join('');
    }
  }

  function renderNode(n){
    if(!n) return '';
    const open=openIds.has(n.id);
    const chevron = open ? \`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>\` : \`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>\`;
    return \`<div class="folder-group">
      <div class="folder-header" onclick="toggleFolder('\${n.id}')">
        <span style="display:flex;align-items:center;width:14px;opacity:0.6">\${chevron}</span> \${n.name}
      </div>
      <div class="folder-children \${open?'open':''}">
        \${n.children.map(renderNode).join('')}
        \${n.files.map(f=>\`<button class="doc-item \${f.id===activeId?'active':''}" onclick="openDoc('\${f.id}')">\${f.name}</button>\`).join('')}
      </div>
    </div>\`;
  }

  window.toggleFolder = id => { if(openIds.has(id)) openIds.delete(id); else openIds.add(id); render(); };

  window.openDoc = (id, mode) => {
    activeId=id; if(mode) mdMode = mode;
    const doc=docs.find(d=>d.id===id);
    if(!doc) return;
    
    dashboard.style.display = 'none';
    frame.style.display = 'block';
    document.getElementById('dashboard-link').classList.remove('active');
    document.getElementById('v-top').style.display='flex';
    document.getElementById('v-title').textContent=doc.name;
    viewerOverlay.style.display = 'flex';
    frame.style.opacity = '0';
    frame.onload = () => { viewerOverlay.style.display = 'none'; frame.style.opacity = '1'; };
    driveLink.href = \`https://drive.google.com/file/d/\${id}/view\`;
    const isMd = doc.mimeType==='text/markdown' || doc.name.toLowerCase().endsWith('.md') || doc.name.toLowerCase().endsWith('.markdown');
    const isReadme = doc.name.toLowerCase() === 'readme';
    if (isReadme) { document.getElementById('md-toggle').style.display = 'none'; mdMode = 'rendered'; }
    else { document.getElementById('md-toggle').style.display = isMd ? 'flex' : 'none'; }
    if(isMd) {
      document.getElementById('btn-render').classList.toggle('active', mdMode==='rendered');
      document.getElementById('btn-raw').classList.toggle('active', mdMode==='raw');
    }
    history.pushState({id},'','/view/'+id);
    if(doc.useViewer) {
      frame.removeAttribute('sandbox');
      frame.src = \`https://drive.google.com/file/d/\${id}/preview\`;
    } else {
      if(doc.mimeType==='application/pdf') frame.removeAttribute('sandbox');
      else frame.setAttribute('sandbox','allow-same-origin allow-scripts allow-popups allow-forms');
      const bust = cacheVersion ? \`v=\${cacheVersion}\` : '';
      const sep = bust ? '?' : '';
      frame.src='/api/doc/'+id + sep + bust + (isMd ? (bust ? '&' : '?')+'mode='+mdMode : '');
    }
    render();
  };

  document.getElementById('btn-render').onclick = () => openDoc(activeId, 'rendered');
  document.getElementById('btn-raw').onclick = () => openDoc(activeId, 'raw');
  document.getElementById('menu-toggle').onclick = () => {
    if (window.innerWidth <= 620) {
      sidebar.classList.toggle('open');
    } else {
      sidebar.classList.toggle('collapsed');
    }
  };
  document.getElementById('logo-link').onclick = (e) => { e.preventDefault(); showDashboard(); };
  document.getElementById('dashboard-link').onclick = () => showDashboard();
  document.getElementById('docs-link').onclick = () => {
    window.open('/DOCUMENTATION.html', '_blank');
  };

  document.getElementById('btn-refresh').onclick = () => {
    window.location.reload();
  };

  document.getElementById('btn-clear-cache').onclick = async () => {
    if (confirm('Clear all cached data? This will refresh all documents.')) {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    }
  };
  document.getElementById('modal-cancel').onclick = () => { modal.style.display = 'none'; pendingAction = null; };
  document.getElementById('modal-confirm').onclick = async () => {
    const action = pendingAction;
    pendingAction = null;
    modal.style.display = 'none';

    if (action === 'clear-cache') {
      document.getElementById('overlay-title').textContent = 'Clearing cache, please wait...';
      document.getElementById('overlay-desc').textContent = 'Purging Cloudflare and browser cache.';
      refreshOverlay.style.display = 'flex';
      try {
        const res = await fetch('/api/clear-cache', {method:'POST'});
        const data = await res.json();
        if (res.status === 429) {
          refreshOverlay.style.display = 'none';
          document.getElementById('modal-title').textContent = 'Cooldown Active';
          document.getElementById('modal-desc').textContent = data.error;
          document.getElementById('modal-confirm').style.display = 'none';
          modal.style.display = 'flex';
          return;
        }
        // Clear browser Cache API
        if ('caches' in window) {
          const names = await caches.keys();
          await Promise.all(names.map(n => caches.delete(n)));
        }
        cacheVersion = Date.now();
        await load();
        // If a doc is open, force-reload it bypassing browser cache
        if (activeId) openDoc(activeId, mdMode);
      } catch (e) { alert('Cache clear failed'); }
      refreshOverlay.style.display = 'none';
    } else {
      document.getElementById('overlay-title').textContent = 'Refreshing, please wait...';
      document.getElementById('overlay-desc').textContent = 'Updating the global repository cache.';
      refreshOverlay.style.display = 'flex';
      try {
        const res = await fetch('/api/refresh', {method:'POST'});
        const data = await res.json();
        if (res.status === 429) {
          refreshOverlay.style.display = 'none';
          document.getElementById('modal-title').textContent = 'Cooldown Active';
          document.getElementById('modal-desc').textContent = data.error;
          document.getElementById('modal-confirm').style.display = 'none';
          modal.style.display = 'flex';
          return;
        }
        await load();
      } catch (e) { alert('Refresh failed'); }
      refreshOverlay.style.display = 'none';
    }
  };
  document.getElementById('search').oninput = render;
  window.onpopstate = e => {
    if (e.state?.id) openDoc(e.state.id);
    else load();
  };
  window.onmessage = e => e.data?.type==='NAVIGATE' && openDoc(e.data.id);
  load();
})();
</script>
</body></html>`;
}
