// Cogwild pictures: players' own profile pictures and club pictures.
//
// The game crops the picture square on the player's device and resizes it to 256×256 (a small JPEG); it's shown as
// a circle. The server only keeps square JPEGs of 256×256 or smaller and up to 64 KB, saved as files in DATA_DIR/pics, and serves them at
// /pic/u/<player>.jpg and /pic/c/<club id>.jpg (the ?v= number changes with each new picture, so browsers may cache).
// Nobody else can pick your picture: it isn't one of the shared avatars. "Quick chat only" accounts can't upload.
'use strict';
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 64 * 1024;
const MAX_SIDE = 256; // the game resizes pictures to 256×256 before sending, so each is only ~10-30 KB
const key = (name) => String(name || '').toLowerCase();

// width and height of a JPEG (from its SOF marker), or null when it isn't a whole JPEG
function jpegSize(b) {
  if (b.length < 200 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const mk = b[i + 1];
    if (mk === 0xd8 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0x01) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return null;
    // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
    if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

class Pics {
  // a: the Accounts object; dir: where the files go
  constructor(a, dir) {
    this.a = a;
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }
  file(kind, id) { return path.join(this.dir, `${kind}-${id}.jpg`); }

  handle(c, m) {
    if (m.t !== 'picSet') return false;
    this.set(c, m);
    return true;
  }
  // { kind: 'u' (yours) | 'c' (your club, owner only), data: base64 JPEG | null to remove }
  set(c, m) {
    const u = this.a.me(c);
    if (!u) return this.a.err(c, 'Log in to use your own picture');
    const now = Date.now();
    if (now - (c.picAt || 0) < 5000) return this.a.err(c, 'Wait a few seconds before changing the picture again');
    let target, id;
    if (m.kind === 'c') {
      target = this.a.clubOf(u);
      if (!target || target.owner !== c.user) return this.a.err(c, 'Only the club owner can change its picture');
      id = target.id;
    } else {
      if (u.cm === 'quick') return this.a.err(c, 'Pictures are off with Quick chat only (Settings › Chat)');
      target = u;
      id = c.user;
    }
    if (!/^[a-z0-9_]{1,40}$/.test(id)) return;
    const kind = m.kind === 'c' ? 'c' : 'u';
    if (m.data == null) {
      try { fs.unlinkSync(this.file(kind, id)); } catch (e) { /* none */ }
      delete target.pv;
    } else {
      const b64 = String(m.data);
      if (b64.length > MAX_BYTES * 1.4) return this.a.err(c, 'That picture is too big');
      const buf = Buffer.from(b64, 'base64');
      const size = jpegSize(buf);
      if (!size || buf.length > MAX_BYTES) return this.a.err(c, "That picture couldn't be used. Try another one.");
      if (size.w !== size.h || size.w > MAX_SIDE || size.w < 32) return this.a.err(c, 'Pictures must be square (1:1) and at most 256×256');
      const tmp = this.file(kind, id) + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, this.file(kind, id));
      target.pv = ((target.pv | 0) % 1e6) + 1;
    }
    c.picAt = now;
    this.a.dirty();
    // everyone who shows it gets the new picture
    if (kind === 'c') return this.a.clubChanged(target);
    this.a.send(c, { t: 'acctMe', me: this.a.publicCard(u) });
    this.a.friendsChanged(c.user);
    this.a.sendParty(c.user);
    const club = this.a.clubOf(u);
    if (club) this.a.clubChanged(club);
  }
  // an account or club is gone: so is its picture
  drop(kind, id) { try { fs.unlinkSync(this.file(kind, id)); } catch (e) { /* none */ } }
  // a player changed their username: the picture moves to the new name
  move(kind, from, to) { try { fs.renameSync(this.file(kind, from), this.file(kind, to)); } catch (e) { /* no picture */ } }

  // GET /pic/u/<name>.jpg or /pic/c/<id>.jpg: true when it answered
  serve(url, res, headers) {
    const m = /^\/pic\/(u|c)\/([a-z0-9_]{1,40})\.jpg$/.exec(url);
    if (!m) return false;
    const f = this.file(m[1], key(m[2]));
    fs.stat(f, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404, headers); return res.end(); }
      res.writeHead(200, Object.assign({}, headers, { 'Content-Type': 'image/jpeg', 'Content-Length': st.size, 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin' }));
      fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
    });
    return true;
  }
}

module.exports = { Pics, jpegSize };
