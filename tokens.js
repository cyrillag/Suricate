const crypto = require('crypto');

// Per-user Jira/Confluence PATs (see FUNCTIONAL_RULES.md "Personal access tokens"), encrypted at
// rest with AES-256-GCM. The key is derived from SESSION_SECRET rather than a new env variable:
// every environment already has its own (each preview gets a fresh one from ops/new-preview.sh),
// so a preview seeded with a copy of prod's database can't decrypt prod's tokens — decrypt() just
// returns null there and the user re-enters theirs. Rotating SESSION_SECRET has the same effect on
// prod: tokens become unreadable and each owner pastes them again; nothing else breaks.
const KEY = crypto.hkdfSync('sha256', process.env.SESSION_SECRET || '', 'suricate', 'user-pat-v1', 32);
const VERSION = 'v1';

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(KEY), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

// null for an empty column (users.jira_token predates this and holds '') or anything this key
// can't open — never throws, a bad row must not take a page down.
function decrypt(stored) {
  if (!stored) return null;
  const [version, iv, tag, data] = stored.split(':');
  if (version !== VERSION || !data) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(KEY), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

module.exports = { encrypt, decrypt };
