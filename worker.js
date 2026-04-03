// ============================================================
// Google Drive HTML Docs Portal — Cloudflare Worker
// ============================================================

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CACHE_KEY_METADATA = "doc_portal_tree_v6";

let subrequestCount = 0;

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

  for (const folderId of folderIds) {
    const url = `${DRIVE_API}/files/${folderId}?fields=id,name&supportsAllDrives=true`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const meta = await res.json();
    if (meta.error) {
      throw new Error(`Drive API Error [meta]: ${meta.error.message} (Folder: ${folderId})`);
    }
    const folderName = meta.name || 'Root';
    folders.push({ id: folderId, name: folderName, parentFolderId: null, isRoot: true });
    await processFolder(folderId, folderName);
  }
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
    if (path === '/' || path.startsWith('/view/')) return new Response(getPortalHtml(env), { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });

    // API: List Docs (Pulling from metadata cache)
    if (path === '/api/docs') {
      try {
        let data = env.CACHE ? await env.CACHE.get(CACHE_KEY_METADATA, 'json') : null;
        if (!data) {
          data = await buildDocList(env);
          if (env.CACHE) await env.CACHE.put(CACHE_KEY_METADATA, JSON.stringify(data));
        }
        return json(data);
      } catch (e) { return json({ error: e.message }, 500); }
    }

    // API: Global Refresh
    if (path === '/api/refresh' && request.method === 'POST') {
      try {
        const data = await buildDocList(env);
        if (env.CACHE) await env.CACHE.put(CACHE_KEY_METADATA, JSON.stringify(data));
        return json({ success: true, updated: data.updated });
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

        // Store content in KV with 7-day TTL
        if (env.CACHE) {
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

function getPortalHtml(env) {
  const companyName = env.COMPANY_NAME || 'DocShuttle';
  const portalTitle = env.PORTAL_TITLE || 'DocShuttle';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${portalTitle}</title>
<link rel="icon" type="image/x-icon" href="/favicon.ico">
<link rel="icon" type="image/png" href="/favicon.png">
<link href="https://api.fontshare.com/v2/css?f[]=satoshi@400,700&display=swap" rel="stylesheet">
<style>
:root{--bg:#f7f6f2;--surf:#ffffff;--text:#28251d;--prim:#01696f;--hl:#cedcd8;--border:#d4d1ca;--muted:#7a7974}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Satoshi',sans-serif;background:var(--bg);color:var(--text);height:100vh;display:flex;flex-direction:column;overflow:hidden}
.topbar{display:flex;align-items:center;padding:0 1.5rem;height:56px;background:var(--surf);border-bottom:1px solid var(--border);gap:1rem;z-index:20}
.logo-container{display:flex;align-items:center;gap:0.75rem;text-decoration:none;color:var(--text);flex-shrink:0}
.logo-svg{width:32px;height:32px}
.logo-text{font-weight:700;font-size:1.1rem;letter-spacing:-0.02em}
.search-wrap{margin-left:auto;width:100%;max-width:320px;position:relative}
#search{width:100%;height:34px;padding:0 1rem;border-radius:17px;border:1px solid var(--border);background:#f3f0ec;font-family:inherit;font-size:14px}
#search:focus{outline:none;border-color:var(--prim);background:#fff}
.body{display:flex;flex:1;overflow:hidden}
.sidebar{width:280px;background:var(--surf);border-right:1px solid var(--border);display:flex;flex-direction:column;transition:width 0.3s cubic-bezier(0.4, 0, 0.2, 1);overflow:hidden}
.sidebar.collapsed{width:0;border-right:none}
.sidebar-content{width:280px;height:100%;display:flex;flex-direction:column;flex-shrink:0}
.sidebar-header{padding:1rem;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)}
.tree-container{flex:1;overflow-y:auto;padding:0.5rem 0}
.sidebar-footer{padding:1rem;border-top:1px solid var(--border);font-size:10px;color:var(--muted);line-height:1.4}
.viewer{flex:1;display:flex;flex-direction:column;position:relative}
.viewer-topbar{height:48px;padding:0 1rem;display:flex;align-items:center;justify-content:space-between;background:var(--surf);border-bottom:1px solid var(--border)}
.btn{padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:#fff;cursor:pointer;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;text-decoration:none;color:inherit}
.btn:hover{background:#f9f8f4}
.btn-toggle{padding:8px;border:none;background:transparent;border-radius:50%}
.btn-toggle:hover{background:var(--hl)}
.btn-prim{background:var(--prim);color:#fff !important;border:none}
.btn-group{display:flex;background:#f3f0ec;padding:2px;border-radius:8px;margin-right:12px}
.btn-group .btn-item{padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:none;background:transparent;color:var(--muted)}
.btn-group .btn-item.active{background:#fff;color:var(--prim);box-shadow:0 2px 4px rgba(0,0,0,0.05)}
.doc-item{padding:8px 12px;cursor:pointer;font-size:14px;border-radius:6px;margin:2px 8px;display:block;text-align:left;border:none;background:transparent;width:calc(100% - 16px);color:var(--text)}
.doc-item:hover{background:#f3f0ec}
.doc-item.active{background:var(--hl);color:var(--prim);font-weight:700}
.folder-header{padding:8px 12px;cursor:pointer;font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px;user-select:none}
.folder-children{display:none;padding-left:1rem;margin-left:1rem;border-left:1px solid var(--border)}
.folder-children.open{display:block}
iframe{flex:1;border:none;background:#fff;transition:opacity 0.2s}

.refresh-overlay{position:fixed;inset:0;background:rgba(255,255,255,0.9);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:200;text-align:center}
.viewer-overlay{position:absolute;inset:0;background:rgba(255,255,255,0.9);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:10;text-align:center}
.loading-logo{width:64px;height:64px;background:url('/favicon.png') no-repeat center;background-size:contain;animation:spin 2s linear infinite;margin-bottom:1rem}
@keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}

.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);display:none;align-items:center;justify-content:center;z-index:100}
.modal{background:#fff;padding:1.5rem;border-radius:12px;width:100%;max-width:320px;box-shadow:0 10px 25px rgba(0,0,0,0.1);text-align:center}
.modal-btns{display:flex;gap:0.75rem;justify-content:center;margin-top:1.5rem}

.doc-card{margin:8px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;display:none}
.doc-card-title{font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:8px}
</style>
</head>
<body>
  <div class="refresh-overlay" id="refresh-overlay">
    <div class="loading-logo"></div>
    <h2 style="color:var(--prim)">Refreshing, please wait...</h2>
    <p style="font-size:13px;color:var(--muted);margin-top:8px">Updating the global repository cache.</p>
  </div>

  <div class="modal-overlay" id="modal">
    <div class="modal">
      <h3>Refresh Repository?</h3>
      <p style="font-size:13px;color:var(--muted);margin-top:8px">Be sure you have added documents to Google Drive before refreshing. This will update the library for all users.</p>
      <div class="modal-btns">
        <button class="btn" id="modal-cancel">Cancel</button>
        <button class="btn btn-prim" id="modal-confirm">Refresh Now</button>
      </div>
    </div>
  </div>

  <header class="topbar">
    <button class="btn-toggle" id="menu-toggle"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
    <div class="logo-container">
      <svg class="logo-svg" viewBox="0 0 1024.8 1024.8"><polygon points="427.6 128.78 968.15 128.78 750.93 506.41 633.13 506.41 810.25 219.01 488.59 219.85 427.6 128.78" style="fill:#5b616e;"/><polygon points="56.65 234.05 427.6 234.05 490.26 335.98 116.8 335.98 56.65 234.05" style="fill:#5b616e;"/><polygon points="599.5 285.01 407.5 590.97 267.19 370.23 142.7 370.23 403.37 780.45 719.39 284.98 599.5 285.01" style="fill:#f59e0b;"/><polygon points="612.24 544.84 442.64 830.58 498.61 919.97 728.37 544.84 612.24 544.84" style="fill:#5b616e;"/></svg>
      <span class="logo-text">${portalTitle}</span>
    </div>
    <div class="search-wrap"><input id="search" placeholder="Search documents..."></div>
  </header>
  <div class="body">
    <nav class="sidebar" id="sidebar">
      <div class="sidebar-content">
        <div class="sidebar-header"><span style="font-size:11px;font-weight:700;color:var(--muted);letter-spacing:0.05em">REPOSITORY</span><button class="btn" id="refresh-btn">Refresh</button></div>
        <div class="tree-container" id="tree"></div>
        <div class="doc-card" id="doc-card">
          <div class="doc-card-title">Documentation</div>
          <button class="btn" style="width:100%; justify-content:center" id="readme-link">Open Documentation</button>
        </div>
        <div class="sidebar-footer">
          <p id="last-refresh" style="margin-bottom:8px; font-weight:600; font-size:9px; opacity:0.7"></p>
          <p><strong>Confidential Internal Use Only</strong></p>
          <p>&copy; <span id="copy-year"></span> ${companyName}. All rights reserved.</p>
        </div>
      </div>
    </nav>
    <main class="viewer">
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
      <iframe id="frame"></iframe>
    </main>
  </div>
<script>
(function(){
  let docs=[], folders=[], activeId=null, openIds=new Set(), mdMode='rendered';
  const treeEl=document.getElementById('tree'), frame=document.getElementById('frame'), sidebar=document.getElementById('sidebar'), modal=document.getElementById('modal'), driveLink=document.getElementById('drive-link');
  const refreshOverlay=document.getElementById('refresh-overlay'), viewerOverlay=document.getElementById('viewer-overlay'), readmeCard=document.getElementById('doc-card');

  document.getElementById('copy-year').textContent = new Date().getFullYear();

  async function load(){
    const res = await fetch('/api/docs');
    const data = await res.json();
    if(data.error) { treeEl.innerHTML = '<div style="padding:1rem;color:red">'+data.error+'</div>'; return; }
    docs=data.docs||[]; folders=data.folders||[];
    if (data.updated) {
      const d = new Date(data.updated);
      document.getElementById('last-refresh').textContent = 'Last Refresh: ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    }
    const readme = docs.find(d => d.name.toLowerCase() === 'readme');
    if (readme) {
      readmeCard.style.display = 'block';
      document.getElementById('readme-link').onclick = () => openDoc(readme.id, 'rendered');
    }
    render();
    const m=location.pathname.match(/^\\/view\\/([A-Za-z0-9_-]+)/);
    if(m) openDoc(m[1]);
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
      treeEl.innerHTML = roots.map(renderNode).join('');
    }
  }

  function renderNode(n){
    if(!n) return '';
    const open=openIds.has(n.id);
    return \`<div class="folder-group">
      <div class="folder-header" onclick="toggleFolder('\${n.id}')">
        <span style="font-size:10px;width:12px">\${open?'▼':'▶'}</span> \${n.name}
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
      frame.src='/api/doc/'+id + (isMd ? '?mode='+mdMode : '');
    }
    render();
  };

  document.getElementById('btn-render').onclick = () => openDoc(activeId, 'rendered');
  document.getElementById('btn-raw').onclick = () => openDoc(activeId, 'raw');
  document.getElementById('menu-toggle').onclick = () => sidebar.classList.toggle('collapsed');
  document.getElementById('refresh-btn').onclick = () => { modal.style.display = 'flex'; };
  document.getElementById('modal-cancel').onclick = () => { modal.style.display = 'none'; };
  document.getElementById('modal-confirm').onclick = async () => {
    modal.style.display = 'none';
    refreshOverlay.style.display = 'flex';
    try { await fetch('/api/refresh', {method:'POST'}); await load(); } catch (e) { alert('Refresh failed'); }
    refreshOverlay.style.display = 'none';
  };
  document.getElementById('search').oninput = render;
  window.onpopstate = e => e.state?.id && openDoc(e.state.id);
  window.onmessage = e => e.data?.type==='NAVIGATE' && openDoc(e.data.id);
  load();
})();
</script>
</body></html>`;
}
