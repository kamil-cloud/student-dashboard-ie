// The extension's "key" (public key) fixes its id, so the website can reach it. Generated once;
// only the public half is kept — Chrome needs nothing else for an unpacked extension.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'extension-key.json');

export function extensionKey() {
  if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = publicKey.export({ type: 'spki', format: 'der' });
  // Chrome's id: first 32 hex chars of SHA-256(public key), with 0–f mapped to a–p.
  const id = [...crypto.createHash('sha256').update(der).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
  const key = { key: der.toString('base64'), id };
  fs.writeFileSync(FILE, `${JSON.stringify(key, null, 2)}\n`);
  return key;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(extensionKey().id);
