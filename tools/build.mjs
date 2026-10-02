// node tools/build.mjs [folder-name]
//
// Assembles site/ into dist/<folder-name>/
// and zips it for one upload through cPanel's File Manager: upload the zip
// into cgcmultimedia.com's folder, Extract, and it lands as <folder-name>/.
// The folder name defaults to "live" (cgcmultimedia.com/live); a test copy
// can go up as e.g. "live-test" without touching the real one.
//
// Two settings are written into the built config.js:
//   phoneUrl   https://cgcmultimedia.com/<folder-name>, what the QR code opens
//   firebase   from firebase-config.json, if it exists (the web app config
//              from the Firebase console; not secret). Without
//              it the build runs in demo mode, and this says so.
// The PHP settings file is NOT in the zip: it goes in the hosting account's
// home folder, outside public_html (README.md).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SITE = path.join(HERE, '..', 'site');
const name = process.argv[2] || 'live';
if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Folder name: lowercase letters, digits and dashes only.');
const outBase = path.join(ROOT, 'dist');
const out = path.join(outBase, name);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(SITE, out, { recursive: true });

const fbPath = path.join(HERE, '..', 'firebase-config.json');
let firebase = null;
if (fs.existsSync(fbPath)) {
  firebase = JSON.parse(fs.readFileSync(fbPath, 'utf8'));
  for (const k of ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'appId']) {
    if (!firebase[k]) throw new Error(`firebase-config.json has no ${k}. Copy the whole config object from Firebase → Project settings → Your apps.`);
  }
  if (/^PASTE-/.test(firebase.apiKey)) throw new Error('firebase-config.json: paste the apiKey from Firebase → Project settings → Your apps → CGC Live web first.');
}
const configFile = path.join(out, 'shared', 'config.js');
let config = fs.readFileSync(configFile, 'utf8');
const swap = (re, value, what) => {
  if (!re.test(config)) throw new Error(`config.js: couldn't find the ${what} line to fill in.`);
  config = config.replace(re, value);
};
swap(/^  firebase: null,$/m, `  firebase: ${JSON.stringify(firebase)},`, 'firebase');
swap(/^  phoneUrl: '[^']*',$/m, `  phoneUrl: ${JSON.stringify('https://cgcmultimedia.com/' + name)},`, 'phoneUrl');
fs.writeFileSync(configFile, config);

const zip = path.join(outBase, name + '.zip');
fs.rmSync(zip, { force: true });
// Each file goes in with an explicit forward-slash name. Windows' own
// ZipFile.CreateFromDirectory writes "shared\config.js", which the Linux
// server extracts as one file with a backslash in its name, not a folder
// (found with the songs website; see tools/build-website.js on lyrics).
const files = [];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(d => {
  const full = path.join(dir, d.name);
  if (d.isDirectory()) walk(full);
  else files.push([full, name + '/' + path.relative(out, full).split(path.sep).join('/')]);
});
walk(out);
const list = path.join(outBase, name + '.files.txt');
fs.writeFileSync(list, files.map(([full, rel]) => full + '|' + rel).join('\n'));
execFileSync('powershell', ['-NoProfile', '-Command',
  "Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem; " +
  "$z = [System.IO.Compression.ZipFile]::Open('" + zip + "', 'Create'); " +
  "try { Get-Content -Encoding UTF8 -LiteralPath '" + list + "' | ForEach-Object { $p = $_.Split('|'); [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($z, $p[0], $p[1]) | Out-Null } } finally { $z.Dispose() }"]);
fs.rmSync(list);

console.log(`built ${path.relative(ROOT, out)} (${files.length} files) and ${path.relative(ROOT, zip)} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
console.log(`  QR code opens https://cgcmultimedia.com/${name}`);
console.log(firebase
  ? `  Firebase project: ${firebase.projectId}`
  : '  NO firebase-config.json: this build runs in DEMO mode (this browser only). See README.md.');
