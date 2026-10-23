// Cogwild — "Sign in with Google" in the player's own browser.
// The game opens /auth/google?s=<secret> in the default browser; that sends the player to Google, Google sends them
// back to /auth/google/done with an ID token, and that page hands the token to the server, which logs in the game
// that is waiting with the same secret (server/accounts.js googleStart / googleDone).
// GOOGLE_CLIENT_ID (environment) is the OAuth client from Google Cloud Console (Web application,
// authorized redirect URI = https://<the game's address>/auth/google/done). The token must be signed by Google,
// for us, not expired, and carry the nonce we asked for.
'use strict';
const https = require('https');
const http = require('http');
const crypto = require('crypto');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CERTS_URL = process.env.GOOGLE_CERTS_URL || 'https://www.googleapis.com/oauth2/v3/certs'; // tests point this elsewhere
const ISSUERS = (process.env.GOOGLE_ISSUERS || 'accounts.google.com,https://accounts.google.com').split(',');
let keys = null, keysAt = 0;

function fetchJson(url) {
  return new Promise((res, rej) => {
    (url.startsWith('https:') ? https : http).get(url, (r) => {
      let d = '';
      r.on('data', (c) => { d += c; if (d.length > 200000) r.destroy(); });
      r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
    }).on('error', rej).setTimeout(8000, function () { this.destroy(new Error('timeout')); });
  });
}
async function key(kid) {
  if (!keys || Date.now() - keysAt > 3600000 || !keys[kid]) {
    const set = await fetchJson(CERTS_URL);
    keys = {};
    for (const k of set.keys || []) keys[k.kid] = crypto.createPublicKey({ key: k, format: 'jwk' });
    keysAt = Date.now();
  }
  return keys[kid];
}
const part = (s) => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

// the verified email of a Google ID token, or an error (nonce: the one we sent Google, when there was one)
async function verify(token, nonce) {
  if (!CLIENT_ID) throw new Error('Google sign-in is not set up');
  const bits = String(token || '').split('.');
  if (bits.length !== 3 || token.length > 4096) throw new Error('bad token');
  const head = part(bits[0]), body = part(bits[1]);
  if (head.alg !== 'RS256') throw new Error('bad token');
  const k = await key(head.kid);
  if (!k || !crypto.verify('RSA-SHA256', Buffer.from(bits[0] + '.' + bits[1]), k, Buffer.from(bits[2], 'base64url'))) throw new Error('bad signature');
  if (body.aud !== CLIENT_ID || !ISSUERS.includes(body.iss)) throw new Error('token is not for this game');
  if (!(body.exp * 1000 > Date.now())) throw new Error('token expired');
  if (nonce && body.nonce !== nonce) throw new Error('token is not for this sign-in');
  if (!body.email || body.email_verified !== true) throw new Error('Google account has no verified email');
  return String(body.email).toLowerCase();
}

// where the player's browser goes to sign in: Google's page, which comes back to <origin>/auth/google/done
function authUrl(origin, secret) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: origin + '/auth/google/done', response_type: 'id_token', scope: 'openid email',
    nonce: nonceOf(secret), state: secret,
  });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString();
}
const nonceOf = (secret) => crypto.createHash('sha256').update('cogwild-google:' + secret).digest('hex');

module.exports = { verify, authUrl, nonceOf, clientId: CLIENT_ID };
