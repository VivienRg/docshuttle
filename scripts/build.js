const { GoogleDrive } = require('./drive-downloader.cjs');
const fs = require('fs');
const path = require('path');

async function build() {
  console.log('Downloading files from Google Drive...');
  
  const drive = new GoogleDrive({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
  });
  
  const folderIds = (process.env.FOLDER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const outDir = path.join(__dirname, 'static');
  
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  const docs = [];
  let docIndex = 0;
  
  for (const folderId of folderIds) {
    console.log(`Processing folder: ${folderId}`);
    const files = await drive.listFiles(folderId);
    
    for (const file of files) {
      console.log(`Downloading: ${file.name} (${file.mimeType})`);
      
      const content = await drive.downloadFile(file.id, file.mimeType);
      const ext = getExtension(file.mimeType, file.name);
      const id = docIndex.toString(36);
      
      const safeName = file.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${id}_${safeName}${ext}`;
      
      fs.writeFileSync(path.join(outDir, filename), content);
      
      docs.push({
        id,
        name: file.name.replace(/\.html?$/i, '').replace(/\.pdf$/i, '').replace(/\.md$/i, ''),
        filename,
        mimeType: file.mimeType,
        modifiedTime: file.modifiedTime,
        folder: file.folder || '',
      });
      
      docIndex++;
    }
  }
  
  fs.writeFileSync(path.join(outDir, 'docs.json'), JSON.stringify(docs, null, 2));
  console.log(`Done! Downloaded ${docs.length} files.`);
}

function getExtension(mimeType, filename) {
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'text/markdown' || filename.endsWith('.md')) return '.md';
  if (mimeType === 'application/vnd.google-apps.document') return '.html';
  return '.html';
}

build().catch(console.error);