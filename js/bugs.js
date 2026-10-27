// Cogwild — automatic bug reports. When something in the game throws, the error (its message, where in the code,
// the game's version, what it runs on and which screen was open) goes to the server by itself (server/stats.js) and
// shows on the moderation page. No names, chat, settings or addresses are sent. Without a connection the reports
// wait on the device (at most 10) and go out on the next connection. Errors from add-ons and other sites' scripts
// are left out.
(function () {
  const CW = (window.CW = window.CW || {});
  const KEY = 'cogwild.bugs', QUEUE_MAX = 10, SESSION_MAX = 15;
  let queue = [];
  try { queue = JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { /* no storage */ }
  const sent = new Set();
  let count = 0, send = null;
  const save = () => { try { if (queue.length) localStorage.setItem(KEY, JSON.stringify(queue.slice(-QUEUE_MAX))); else localStorage.removeItem(KEY); } catch (e) { /* no storage */ } };
  // a link in a stack line -> just the file name ("game.js:120:7")
  const short = (s) => String(s || '').replace(/(?:https?|file|capacitor|app|wss?):\/\/[^\s)?#]*\/([\w.-]+)(?:[?#][^\s):]*)?(:\d+:\d+)?/g, '$1$2');
  // only errors from the game's own files (not browser add-ons, portal ads or other sites' scripts)
  const ours = (src) => !src || (/^(?:https?|file|capacitor|app):/.test(src) && !/-extension:|\/\/(?:[^/]*\.)?(?:poki|crazygames|googlesyndication|google|doubleclick|gstatic)\./.test(src) && (/\/js\/[\w./-]+\.js|\/index\.html|\/$/.test(src.split('?')[0])));
  const NOISE = /^(?:Script error\.?|ResizeObserver loop|.*\b(?:NotAllowedError|AbortError)\b|.*The play\(\) request was interrupted)/i;

  // what the game runs on, also sent with 'hello' for the daily stats
  CW.platName = () => {
    if (CW.PORTAL) return String(CW.PORTAL);
    const ua = navigator.userAgent || '';
    if (window.CogwildNative || CW.APP === 'android') return 'android';
    if (/Electron/.test(ua)) return CW.STORE ? 'store' : /Mac/.test(ua) ? 'mac' : /Linux/.test(ua) ? 'linux' : 'windows';
    return /Android|iPhone|iPad|iPod|Mobi/i.test(ua) ? 'web-phone' : 'web';
  };

  function report(err, kind, where, src) {
    try {
      if (count >= SESSION_MAX || !ours(src)) return;
      const e = err && typeof err === 'object' && 'message' in err ? err : null;
      let msg = e ? (e.name && e.name !== 'Error' ? e.name + ': ' : '') + e.message : String(err);
      msg = short(msg).slice(0, 300);
      if (!msg || NOISE.test(msg)) return;
      const stack = e && e.stack ? short(e.stack).split('\n').filter((l) => !/^\s*$/.test(l)).slice(0, 10).join('\n').slice(0, 1500) : '';
      // where: the first line of the stack that's in one of our files
      const at = stack.split('\n').map((l) => (l.match(/([\w.-]+\.(?:js|html):\d+:\d+)/) || [])[1]).find(Boolean);
      where = short(where || at || '').slice(0, 120);
      const sig = msg + '|' + where;
      if (sent.has(sig)) return;
      sent.add(sig);
      count++;
      const g = window.game;
      const m = { t: 'bug', kind: kind || 'error', msg, where, stack, ver: CW.VERSION || '?', state: g ? `${g.state || '?'}${g.modeId ? '/' + g.modeId : ''}` : 'loading' };
      if (send) send(m);
      else { queue.push(m); queue = queue.slice(-QUEUE_MAX); save(); }
    } catch (x) { /* reporting must never break the game */ }
  }
  CW.Bugs = {
    report,
    // the net layer: connected (sends what waited) / disconnected
    online(fn) {
      send = fn;
      if (!fn || !queue.length) return;
      for (const m of queue.splice(0)) fn(m);
      save();
    },
  };
  window.addEventListener('error', (ev) => {
    if (ev.target && ev.target !== window) return; // a picture or file that didn't load (not a bug in the game)
    report(ev.error || ev.message, 'error', ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : '', ev.filename);
  });
  window.addEventListener('unhandledrejection', (ev) => report(ev.reason, 'promise'));
})();
