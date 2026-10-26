// Cogwild moderation page (admin.html, server/admin.js). The key stays in this browser only (if "remember" is on).
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const when = (t) => (t ? new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const until = (t) => (t && t > Date.now() ? (t - Date.now() > 3000 * 86400000 ? 'for good' : 'until ' + when(t)) : '');
  let key = '';
  try { key = localStorage.getItem('cogwild.adminKey') || ''; } catch (e) { /* private window */ }
  let data = null, tab = 'reports';

  const say = (text, err) => { $('msg').textContent = text || ''; $('msg').className = err ? 'err' : ''; };
  async function api(path) {
    const r = await fetch('/admin/api/' + path, { headers: { 'X-Admin-Token': key }, cache: 'no-store' });
    const j = await r.json().catch(() => ({ err: 'The server answered strangely' }));
    if (!r.ok || j.err) throw new Error(j.err || 'Error ' + r.status);
    return j;
  }
  async function load() {
    try {
      data = await api('overview');
      $('keyRow').classList.add('hidden');
      $('outRow').classList.remove('hidden');
      $('app').classList.remove('hidden');
      const s = data.stats;
      $('stats').textContent = `${s.accounts} accounts · ${s.online} online · ${s.rooms} rooms · ${s.gallery} gallery mechs`;
      document.querySelector('[data-tab="reports"]').textContent = `🚩 Reports (${s.openReports})`;
      say('');
      render();
    } catch (e) {
      say(e.message, true);
      $('keyRow').classList.remove('hidden');
      $('outRow').classList.add('hidden');
      $('app').classList.add('hidden');
    }
  }
  async function act(params, done) {
    try {
      const q = new URLSearchParams(params).toString();
      const r = await api('act?' + q);
      say('Done ✔');
      if (done) done(r); else load();
    } catch (e) { say(e.message, true); }
  }
  const actions = (name) => `<div class="row">
      <button class="bad" data-act="mute" data-name="${esc(name)}" data-hours="24">🔇 Mute 1 day</button>
      <button class="bad" data-act="mute" data-name="${esc(name)}" data-hours="168">🔇 Mute 7 days</button>
      <button class="bad" data-act="ban" data-name="${esc(name)}" data-hours="168">⛔ Ban 7 days</button>
      <button class="bad" data-act="ban" data-name="${esc(name)}" data-hours="0">⛔ Ban for good</button>
      <button data-act="quick" data-name="${esc(name)}">💬 Quick chat only</button>
    </div>`;

  function render() {
    const v = $('view');
    document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'reports') {
      v.innerHTML = data.reports.length ? data.reports.map((r) => `<div class="card">
          <div class="row"><b><span class="name" data-player="${esc(r.who)}">${esc(r.who)}</span></b><span class="tag ${r.where === 'gallery' ? '' : 'bad'}">${esc(r.why)}</span><span class="small">reported by ${esc(r.by)} · ${esc(r.where || 'chat')} · ${when(r.at)}</span></div>
          ${r.lines && r.lines.length ? `<div class="lines">${r.lines.map((x) => `<div>“${esc(x)}”</div>`).join('')}</div>` : '<div class="small">(no typed lines kept with this report)</div>'}
          ${r.gid ? `<div class="row"><button class="bad" data-mech="hide" data-id="${esc(r.gid)}">Hide the mech</button><button class="bad" data-mech="delmech" data-id="${esc(r.gid)}">Delete the mech</button></div>` : ''}
          ${actions(r.who)}
          <div class="row" style="margin-top:6px"><button class="good" data-dismiss="${r.i}">✓ Dismiss (nothing wrong / handled)</button></div>
        </div>`).join('') : '<div class="card">No open reports. 🎉</div>';
    } else if (tab === 'mechs') {
      v.innerHTML = data.hidden.length ? data.hidden.map((m) => `<div class="card row"><b>${esc(m.n)}</b><span class="small">by <span class="name" data-player="${esc(m.by)}">${esc(m.by)}</span> · ${m.reports} report${m.reports === 1 ? '' : 's'} · ${m.hidden ? '<span class="tag bad">hidden</span>' : 'visible'}</span>
          ${m.hidden ? `<button class="good" data-mech="show" data-id="${esc(m.id)}">Show it again</button>` : `<button class="bad" data-mech="hide" data-id="${esc(m.id)}">Hide</button>`}<button class="bad" data-mech="delmech" data-id="${esc(m.id)}">Delete</button></div>`).join('') : '<div class="card">No reported mechs.</div>';
    } else if (tab === 'people') {
      v.innerHTML = data.people.length ? data.people.map((p) => `<div class="card row"><b class="name" data-player="${esc(p.name)}">${esc(p.name)}</b>
          ${p.banUntil > Date.now() ? `<span class="tag bad">banned ${until(p.banUntil)}</span><button class="good" data-act="unban" data-name="${esc(p.name)}">Unban</button>` : ''}
          ${p.muteUntil > Date.now() ? `<span class="tag bad">${p.autoMuted ? 'auto-' : ''}muted ${until(p.muteUntil)}</span><button class="good" data-act="unmute" data-name="${esc(p.name)}">Unmute</button>` : ''}
          ${p.quick ? '<span class="tag">quick chat only</span>' : ''}</div>`).join('') : '<div class="card">Nobody is muted or banned.</div>';
    } else {
      v.innerHTML = `<div class="card row"><input id="findName" placeholder="Username" maxlength="20"><button id="findGo" class="on">Find</button></div><div id="playerBox"></div>`;
      $('findGo').onclick = () => showPlayer($('findName').value.trim());
      $('findName').onkeydown = (e) => { if (e.key === 'Enter') showPlayer($('findName').value.trim()); };
    }
    bind(v);
  }
  function bind(root) {
    root.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
      const what = b.dataset.act;
      if ((what === 'ban' || what === 'mute') && !b.classList.contains('sure')) { b.classList.add('sure'); b.textContent += ': click again'; return; }
      act({ do: what, name: b.dataset.name, hours: b.dataset.hours || '' }, tab === 'find' ? () => showPlayer(b.dataset.name) : null);
    }));
    root.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = () => act({ do: 'dismiss', i: b.dataset.dismiss })));
    root.querySelectorAll('[data-mech]').forEach((b) => (b.onclick = () => {
      if (b.dataset.mech === 'delmech' && !b.classList.contains('sure')) { b.classList.add('sure'); b.textContent = 'Delete: click again'; return; }
      act({ do: b.dataset.mech, id: b.dataset.id }, tab === 'find' ? () => showPlayer($('findName') && $('findName').value.trim()) : null);
    }));
    root.querySelectorAll('[data-player]').forEach((el) => (el.onclick = () => { tab = 'find'; render(); $('findName').value = el.dataset.player; showPlayer(el.dataset.player); }));
  }
  async function showPlayer(name) {
    if (!name) return;
    const box = $('playerBox');
    box.innerHTML = '<div class="card small">Loading…</div>';
    try {
      const p = await api('player?name=' + encodeURIComponent(name));
      box.innerHTML = `<div class="card">
          <div class="row"><b style="font-size:18px">${esc(p.name)}</b>${p.online ? '<span class="tag">online now</span>' : ''}
            ${p.banUntil > Date.now() ? `<span class="tag bad">banned ${until(p.banUntil)}</span><button class="good" data-act="unban" data-name="${esc(p.name)}">Unban</button>` : ''}
            ${p.muteUntil > Date.now() ? `<span class="tag bad">${p.autoMuted ? 'auto-' : ''}muted ${until(p.muteUntil)}</span><button class="good" data-act="unmute" data-name="${esc(p.name)}">Unmute</button>` : ''}
            ${p.quick ? `<span class="tag">quick chat only</span><button data-act="free" data-name="${esc(p.name)}">Allow typed chat</button>` : ''}</div>
          <div class="small">Joined ${when(p.created)} · last seen ${when(p.seen)} · 🏆 ${p.tro} · ${p.played} matches · ${p.friends} friends${p.club ? ' · club ' + esc(p.club) : ''} · reported others ${p.made} times</div>
          ${p.notes.length ? `<div class="small">Game server notes: ${p.notes.map((n) => esc(n.why) + ' (' + when(n.at) + ')').join(' · ')}</div>` : ''}
          ${actions(p.name)}
        </div>
        ${p.mechs.length ? `<div class="card"><b>Shared mechs</b>${p.mechs.map((m) => `<div class="row"><span>${esc(m.n)}</span><span class="small">${m.reports} reports</span>${m.hidden ? `<span class="tag bad">hidden</span><button class="good" data-mech="show" data-id="${esc(m.id)}">Show</button>` : `<button class="bad" data-mech="hide" data-id="${esc(m.id)}">Hide</button>`}<button class="bad" data-mech="delmech" data-id="${esc(m.id)}">Delete</button></div>`).join('')}</div>` : ''}
        <div class="card"><b>Reports about ${esc(p.name)} (${p.against.length})</b>${p.against.map((r) => `<div style="margin-top:8px"><span class="tag ${r.done ? '' : 'bad'}">${esc(r.why)}${r.done ? ' · dismissed' : ''}</span> <span class="small">by ${esc(r.by)} · ${when(r.at)}</span>${r.lines && r.lines.length ? `<div class="lines">${r.lines.map((x) => `<div>“${esc(x)}”</div>`).join('')}</div>` : ''}</div>`).join('') || '<div class="small">None.</div>'}</div>`;
      bind(box);
    } catch (e) { box.innerHTML = `<div class="card">${esc(e.message)}</div>`; }
  }

  $('open').onclick = () => {
    key = $('key').value.trim();
    try { if ($('remember').checked) localStorage.setItem('cogwild.adminKey', key); } catch (e) { /* fine */ }
    load();
  };
  $('key').onkeydown = (e) => { if (e.key === 'Enter') $('open').click(); };
  $('refresh').onclick = () => load();
  $('forget').onclick = () => { try { localStorage.removeItem('cogwild.adminKey'); } catch (e) { /* fine */ } key = ''; location.reload(); };
  document.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; render(); }));
  if (key) load();
})();
