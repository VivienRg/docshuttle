#!/usr/bin/env node
// Reads secrets from .env and uploads them to the deployed Cloudflare Worker.
// Run after first deploy or whenever secrets change: `npm run secrets`

const { readFileSync, existsSync } = require('fs');
const { resolve } = require('path');
const { spawnSync } = require('child_process');

const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');

if (!existsSync(envPath)) {
  console.error('ERROR: .env not found. Copy .env.template to .env and fill in your values.');
  process.exit(1);
}

const env = {};
readFileSync(envPath, 'utf8')
  .split('\n')
  .filter(line => line.trim() && !line.startsWith('#'))
  .forEach(line => {
    const i = line.indexOf('=');
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });

const SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'FOLDER_IDS'];

for (const key of SECRETS) {
  const value = env[key];
  if (!value) {
    console.warn(`WARN: ${key} is empty in .env — skipping.`);
    continue;
  }
  process.stdout.write(`Uploading ${key}... `);
  const result = spawnSync('npx', ['wrangler', 'secret', 'put', key], {
    input: value,
    encoding: 'utf8',
    cwd: root,
  });
  if (result.status === 0) {
    console.log('done.');
  } else {
    console.error('FAILED.');
    console.error(result.stderr);
    process.exit(1);
  }
}

console.log('All secrets uploaded.');
