const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

class GoogleDrive {
  constructor({ clientId, clientSecret, refreshToken }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.refreshToken = refreshToken;
    this.accessToken = null;
  }

  async getAccessToken() {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    const json = await res.json();
    if (!json.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(json));
    this.accessToken = json.access_token;
    return this.accessToken;
  }

  async request(url, options = {}) {
    if (!this.accessToken) await this.getAccessToken();
    const res = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${this.accessToken}`, ...options.headers },
    });
    if (res.status === 401) {
      await this.getAccessToken();
      return this.request(url, options);
    }
    return res;
  }

  async listFiles(folderId, parentFolder = '') {
    const q = `'${folderId}' in parents and trashed = false`;
    const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,modifiedTime,shortcutDetails)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    
    const res = await this.request(url);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    
    const files = [];
    for (const item of data.files) {
      if (item.mimeType === 'application/vnd.google-apps.folder') continue;
      
      if (item.mimeType === 'application/vnd.google-apps.shortcut') {
        const target = await this.getFileMeta(item.shortcutDetails.targetId);
        if (target) files.push({ ...target, folder: parentFolder });
      } else {
        files.push({ ...item, folder: parentFolder });
      }
    }
    return files;
  }

  async getFileMeta(fileId) {
    const url = `${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,modifiedTime&supportsAllDrives=true`;
    const res = await this.request(url);
    return res.json();
  }

  async downloadFile(fileId, mimeType) {
    let url;
    if (mimeType === 'application/vnd.google-apps.document') {
      url = `${DRIVE_API}/files/${fileId}?mimeType=text/html&supportsAllDrives=true`;
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      url = `${DRIVE_API}/files/${fileId}?mimeType=text/html&supportsAllDrives=true`;
    } else {
      url = `${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`;
    }
    
    const res = await this.request(url);
    
    if (mimeType === 'application/pdf' || mimeType === 'application/vnd.google-apps.document' || mimeType === 'application/vnd.google-apps.spreadsheet') {
      return Buffer.from(await res.arrayBuffer());
    }
    
    return res.text();
  }
}

module.exports = { GoogleDrive };