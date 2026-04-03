#!/usr/bin/env node
// Reads .env and generates:
//   - wrangler.toml  (from wrangler.toml.template)
//   - .dev.vars      (Worker secrets for `wrangler dev`)
// Run once after cloning: `npm run setup`

const { readFileSync, writeFileSync, existsSync } = require('fs');
const { resolve } = require('path');

const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');

if (!existsSync(envPath)) {
  console.error('ERROR: .env not found. Copy .env.template to .env and fill in your values.');
  process.exit(1);
}

// Parse .env into a key→value map (skip comments and blank lines)
const env = {};
readFileSync(envPath, 'utf8')
  .split('\n')
  .filter(line => line.trim() && !line.startsWith('#'))
  .forEach(line => {
    const i = line.indexOf('=');
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });

// ── Generate wrangler.toml from template ─────────────────────
const templatePath = resolve(root, 'wrangler.toml.template');
if (!existsSync(templatePath)) {
  console.error('ERROR: wrangler.toml.template not found.');
  process.exit(1);
}
const toml = readFileSync(templatePath, 'utf8')
  .replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in env)) {
      console.error(`ERROR: {{${key}}} in wrangler.toml.template has no matching entry in .env`);
      process.exit(1);
    }
    return env[key];
  });
writeFileSync(resolve(root, 'wrangler.toml'), toml);
console.log('wrangler.toml generated.');

// ── Generate .dev.vars (secrets only) ────────────────────────
// Wrangler injects [vars] from wrangler.toml automatically in local dev.
// Only Worker secrets need to be listed in .dev.vars.
const SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'FOLDER_IDS'];
const devVars = SECRETS
  .filter(key => key in env)
  .map(key => `${key}=${env[key]}`)
  .join('\n');
writeFileSync(resolve(root, '.dev.vars'), devVars + '\n');
console.log('.dev.vars generated — ready for `npm run dev`.');
