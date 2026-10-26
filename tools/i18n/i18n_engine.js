// Cogwild — languages. The game is written in English; this layer translates what's on screen while it plays: each
// text and aria-label / placeholder is looked up in the chosen language (js/lang/<id>.js, one translation per entry
// of KEYS below: the English text with numbers written {n} and without leading emoji, which are kept as they are).
// Anything not in the list stays English. Players' own words (names, chat, mech names) sit in [translate=no] and are
// never touched. The language is picked in Settings › Display (the page reloads) or from the device's language.
(function () {
  const CW = window.CW;
  CW.LANGS = [['en', 'English'], ['es', 'Español'], ['pt', 'Português'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'], ['ru', 'Русский'],
    ['tr', 'Türkçe'], ['hi', 'हिन्दी'], ['ar', 'العربية'], ['he', 'עברית'], ['zh', '中文'], ['ja', '日本語']];
  const RTL = new Set(['ar', 'he']);
  const KEYS = /*KEYS*/[];
  CW.LANG_DATA = CW.LANG_DATA || {};
  const I = (CW.I18N = { lang: 'en', dict: null });
  const cache = new Map(), done = new WeakMap(), attrDone = new WeakMap();
  const NUM = /\d+(?:[.,]\d+)?/g;

  // the chosen language: Settings, else the device's language when we have it, else English
  function chosen() {
    let saved = null;
    try { const p = JSON.parse(localStorage.getItem('cogwild.profile') || 'null'); saved = p && p.settings && p.settings.lang; } catch (e) { /* no storage */ }
    const ok = (id) => CW.LANGS.some(([x]) => x === id);
    if (ok(saved)) return saved;
    const dev = String(navigator.language || 'en').slice(0, 2).toLowerCase();
    return ok(dev) ? dev : 'en';
  }
  // one text → its translation (or itself)
  function tr(s) {
    const hit = cache.get(s);
    if (hit !== undefined) return hit;
    let out = s;
    const m = /^([^\p{L}\p{N}]*)([\s\S]*?)(\s*)$/u.exec(s);
    if (m && m[2]) {
      const nums = [];
      const key = m[2].replace(NUM, (d) => { nums.push(d); return '{n}'; });
      let t = I.dict.get(key), tail = '';
      // a symbol after the words ("Dash ⇧", "Start ▶"): look the words up without it
      if (!t) { const q = /^([\s\S]*?)(\s*[^\p{L}\p{N})…!?.:'"]+)$/u.exec(key); if (q && q[1]) { t = I.dict.get(q[1]); tail = q[2]; } }
      if (t) { let k = 0; out = m[1] + t.replace(/\{n\}/g, () => (k < nums.length ? nums[k++] : '')) + tail.replace(/\{n\}/g, () => (k < nums.length ? nums[k++] : '')) + m[3]; }
    }
    if (cache.size > 20000) cache.clear();
    cache.set(s, out);
    return out;
  }
  I.t = (s) => (I.dict ? tr(s) : s);
  // players' own words: names in lists, the chat, mech names in the gallery, name tags
  const skip = (el) => !el || !!el.closest('[translate=no],script,style,textarea,#chat,.fr-name,.club-tag,.gal-card b,.gal-info h2,.gal-pcard b');
  function textNode(n) {
    if (done.get(n) === n.data || skip(n.parentElement)) return;
    const t = tr(n.data);
    if (t !== n.data) n.data = t;
    done.set(n, n.data);
  }
  function attrs(el) {
    if (skip(el)) return;
    for (const a of ['aria-label', 'placeholder']) {
      const v = el.getAttribute(a);
      if (!v) continue;
      const seen = attrDone.get(el) || {};
      if (seen[a] === v) continue;
      const t = tr(v);
      if (t !== v) el.setAttribute(a, t);
      seen[a] = t;
      attrDone.set(el, seen);
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return textNode(root);
    if (root.nodeType !== 1) return;
    if (root.hasAttribute('aria-label') || root.hasAttribute('placeholder')) attrs(root);
    root.querySelectorAll('[aria-label],[placeholder]').forEach(attrs);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) textNode(n);
  }
  function start() {
    walk(document.body);
    new MutationObserver((list) => {
      for (const r of list) {
        if (r.type === 'characterData') textNode(r.target);
        else if (r.type === 'attributes') attrs(r.target);
        else for (const n of r.addedNodes) walk(n);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'placeholder'] });
  }
  // switching: saved in Settings, then the page reloads in the new language
  I.set = (id) => {
    try {
      const p = JSON.parse(localStorage.getItem('cogwild.profile') || '{}');
      p.settings = Object.assign(p.settings || {}, { lang: id });
      localStorage.setItem('cogwild.profile', JSON.stringify(p));
    } catch (e) { /* no storage */ }
    location.reload();
  };

  I.lang = chosen();
  document.documentElement.lang = I.lang;
  if (I.lang === 'en') return;
  document.documentElement.classList.toggle('rtl', RTL.has(I.lang));
  const s = document.createElement('script');
  s.src = `js/lang/${I.lang}.js?v=${CW.LANG_V || 1}`;
  s.onload = () => {
    const list = CW.LANG_DATA[I.lang];
    if (!Array.isArray(list)) return;
    I.dict = new Map();
    KEYS.forEach((k, i) => { if (list[i]) I.dict.set(k, list[i]); });
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  };
  document.head.appendChild(s);
})();
