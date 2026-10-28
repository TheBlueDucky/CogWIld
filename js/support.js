// Cogwild — the support page (support.html, server/support.js). Sign in with Google (the same way the game does:
// a secret, Google, then /auth/google/done hands the token to the server and comes back here), then write a message.
// No Google? The link at the bottom opens Gmail with our address filled in.
(function () {
  const $ = (id) => document.getElementById(id);
  const MAIL = 'theblueduckymc@gmail.com';
  const store = window.sessionStorage;
  const get = (k) => { try { return store.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { if (v == null) store.removeItem(k); else store.setItem(k, v); } catch (e) { /* private window */ } };
  // the game adds its version and device (?v=1.9.4&d=android); kept through the trip to Google
  const q = new URLSearchParams(location.search);
  if (q.get('v')) set('cw.support.v', q.get('v').slice(0, 16));
  if (q.get('d')) set('cw.support.d', q.get('d').slice(0, 24));
  if (location.search) history.replaceState(null, '', location.pathname);
  const ver = get('cw.support.v') || '', dev = get('cw.support.d') || '';
  $('mailLink').href = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(MAIL) + '&su=' + encodeURIComponent('Cogwild support' + (ver ? ' ' + ver : ''))
    + '&body=' + encodeURIComponent(`Game version: ${ver || '?'}${dev ? ' (' + dev + ')' : ''}\nUsername: \n\nWhat happened:\n`);

  const show = (id) => document.querySelectorAll('.step').forEach((s) => s.classList.toggle('on', s.id === id));
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then((r) => r.json().catch(() => ({})).then((j) => ({ ok: r.ok, j })));
  const secret = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); };
  let kind = 'bug', email = '';

  function signIn() {
    const s = secret();
    set('cw.support.s', s);
    location.href = '/auth/google?s=' + s;
  }
  function form(w) {
    email = w.email;
    $('whoEmail').textContent = w.email;
    if (w.name && !$('user').value) $('user').value = w.name;
    show('stepForm');
    setTimeout(() => $('text').focus(), 50);
  }
  async function start() {
    const s = get('cw.support.s');
    if (s) {
      const r = await post('/support/who', { s }).catch(() => null);
      if (r && r.ok) return form(r.j);
      set('cw.support.s', null);
    }
    // Google sign-in set up on this server? (if not, only the email link is left)
    const g = await fetch('/auth/google?s=' + '0'.repeat(32), { redirect: 'manual' }).catch(() => null);
    if (g && g.status === 404) { const st = $('stepSign'); st.querySelector('.row').remove(); st.querySelector('p.small').remove(); st.querySelector('p').textContent = 'Write to us by email: use the link below.'; }
    show('stepSign');
  }

  $('signIn').onclick = signIn;
  $('signOut').onclick = () => { set('cw.support.s', null); show('stepSign'); };
  $('kinds').querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => {
    kind = b.dataset.kind;
    $('kinds').querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('kinds').querySelector('[data-kind="bug"]').classList.add('on');
  $('text').oninput = () => { $('count').textContent = $('text').value.length; };
  $('send').onclick = async () => {
    $('err').textContent = '';
    $('send').disabled = true;
    const r = await post('/support/send', { s: get('cw.support.s'), kind, text: $('text').value, user: $('user').value, ver, dev }).catch(() => null);
    $('send').disabled = false;
    if (!r) { $('err').textContent = "Couldn't reach the server. Check your internet and try again."; return; }
    if (!r.ok) {
      $('err').textContent = (r.j && r.j.msg) || 'Something went wrong. Please try again.';
      if (/sign in/i.test($('err').textContent)) { set('cw.support.s', null); setTimeout(() => show('stepSign'), 2500); }
      return;
    }
    $('doneEmail').textContent = email;
    $('text').value = '';
    $('count').textContent = '0';
    show('stepDone');
  };
  $('another').onclick = () => show('stepForm');
  start();
})();
