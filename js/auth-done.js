// Cogwild — the page Google sends the player back to (auth.html). It hands Google's token to the server,
// which logs in the game that opened this browser tab (server/accounts.js googleDone).
(function () {
  const $ = (id) => document.getElementById(id);
  const show = (ico, title, text, bad) => {
    $('ico').textContent = ico;
    $('title').textContent = title;
    $('text').textContent = text;
    $('box').classList.toggle('bad', !!bad);
  };
  const q = new URLSearchParams(location.hash.slice(1));
  // the token stays out of the address bar and the browser history
  history.replaceState(null, '', location.pathname);
  const token = q.get('id_token'), s = q.get('state');
  if (q.get('error')) return show('✖', 'Sign-in cancelled', 'Nothing changed. Go back to Cogwild to try again.', true);
  if (!token || !s) return show('✖', 'Something went wrong', 'Go back to Cogwild and start the sign-in again.', true);
  fetch('/auth/google/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s, token }) })
    .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
    .then(({ ok, j }) => {
      if (!ok) return show('✖', "Couldn't sign you in", (j && j.msg) || 'Go back to Cogwild and try again.', true);
      // the support page started this sign-in: back to it (js/support.js)
      let fromSupport = false;
      try { fromSupport = sessionStorage.getItem('cw.support.s') === s; } catch (e) { /* private window */ }
      if (fromSupport) return location.replace('/support');
      show('✅', "You're signed in!", 'Go back to Cogwild: it continues there. You can close this tab.');
      setTimeout(() => window.close(), 1500); // only works for tabs the game opened itself (the website)
    })
    .catch(() => show('✖', "Couldn't reach the game's server", 'Check your internet and try again from Cogwild.', true));
})();
