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
      $('stats').textContent = `${s.today | 0} players today · ${s.accounts} accounts · ${s.online} online · ${s.rooms} rooms · ${s.gallery} gallery mechs`;
      document.querySelector('[data-tab="reports"]').textContent = `🚩 Reports (${s.openReports})`;
      document.querySelector('[data-tab="bugs"]').textContent = `🐞 Bugs (${s.openBugs | 0})`;
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
    } else if (tab === 'stats') {
      v.innerHTML = '<div class="card small">Loading…</div>';
      api('stats').then((s) => { if (tab === 'stats') { v.innerHTML = statsHtml(s); bind(v); } }).catch((e) => { v.innerHTML = `<div class="card">${esc(e.message)}</div>`; });
    } else if (tab === 'bugs') {
      v.innerHTML = '<div class="card small">Loading…</div>';
      api('bugs').then((r) => { if (tab === 'bugs') { v.innerHTML = bugsHtml(r.bugs); bind(v); } }).catch((e) => { v.innerHTML = `<div class="card">${esc(e.message)}</div>`; });
    } else {
      v.innerHTML = `<div class="card row"><input id="findName" placeholder="Username" maxlength="20"><button id="findGo" class="on">Find</button></div><div id="playerBox"></div>`;
      $('findGo').onclick = () => showPlayer($('findName').value.trim());
      $('findName').onkeydown = (e) => { if (e.key === 'Enter') showPlayer($('findName').value.trim()); };
    }
    bind(v);
  }
  // ---- 📈 Stats: players per day (server/stats.js) ----
  const PLAT = { web: 'Website (PC)', 'web-phone': 'Website (phone)', windows: 'Windows app', store: 'Microsoft Store', android: 'Android app', mac: 'Mac app', linux: 'Linux app',
    itch: 'itch.io', crazygames: 'CrazyGames', poki: 'Poki', old: 'Older game versions' };
  const MODE = { clash: 'Workshop Clash', rush: 'Rush Build', koth: 'King of the Hill', gold: 'Gold Rush', bounty: 'Bounty Hunt', race: 'Combat Race', survival: 'Survival', boss: 'Boss Battle' };
  const pct = (x) => (x == null ? '—' : x + '%');
  const sum = (days, f) => days.reduce((s, d) => s + f(d), 0);
  const merge = (days, k) => { const o = {}; for (const d of days) for (const [n, c] of Object.entries(d[k] || {})) o[n] = (o[n] || 0) + c; return Object.entries(o).sort((a, b) => b[1] - a[1]); };
  const avgOf = (list) => { const v = list.filter((x) => x != null); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  function statsHtml(s) {
    const days = s.days, last7 = days.slice(-7), max = Math.max(1, ...days.map((d) => d.n));
    const short = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric' });
    const shareRows = (list, names) => { const tot = list.reduce((a, [, c]) => a + c, 0) || 1; return list.map(([n, c]) => `<tr><td>${esc(names[n] || n)}</td><td>${c}</td><td>${Math.round((c / tot) * 100)}%</td></tr>`).join('') || '<tr><td colspan="3" class="small">Nothing yet</td></tr>'; };
    return `<div class="tiles">
        <div class="tile"><span class="small">Players today</span><b>${s.today.n}</b><span class="small">${s.today.new} new</span></div>
        <div class="tile"><span class="small">Per day (last 7 days)</span><b>${s.avg7}</b><span class="small">average</span></div>
        <div class="tile"><span class="small">Came back next day</span><b>${pct(avgOf(days.slice(-15).map((d) => d.d1)))}</b><span class="small">new players, last 2 weeks</span></div>
        <div class="tile"><span class="small">Came back after a week</span><b>${pct(avgOf(days.slice(-30).map((d) => d.d7)))}</b><span class="small">new players, last month</span></div>
        <div class="tile"><span class="small">Matches (last 7 days)</span><b>${sum(last7, (d) => d.online + d.solo)}</b><span class="small">${sum(last7, (d) => d.online)} online</span></div>
        <div class="tile"><span class="small">Different players ever</span><b>${s.everyone}</b><span class="small">since stats began</span></div>
      </div>
      <div class="card"><b>Players per day</b> <span class="small"><span class="key" style="background:var(--hl)"></span>came back <span class="key" style="background:#7bd389"></span>new</span>
        <div class="chart">${days.map((d) => `<div aria-label="${esc(short(d.day))}: ${d.n} players, ${d.new} new"><i style="height:${((d.n - d.new) / max) * 100}%"></i><i class="new" style="height:${(d.new / max) * 100}%"></i></div>`).join('')}</div>
        <div class="axis"><span>${short(days[0].day)}</span><span>${short(days[15].day)}</span><span>today</span></div></div>
      <div class="row" style="align-items:flex-start">
        <div class="card" style="flex:1;min-width:260px"><b>What they play on</b> <span class="small">(last 7 days)</span><table><tr><th></th><th>players</th><th></th></tr>${shareRows(merge(last7, 'plat'), PLAT)}</table></div>
        <div class="card" style="flex:1;min-width:260px"><b>Modes</b> <span class="small">(matches, last 7 days)</span><table><tr><th></th><th>matches</th><th></th></tr>${shareRows(merge(last7, 'modes'), MODE)}</table></div>
      </div>
      <div class="card tbl"><b>Day by day</b><table><tr><th>Day (UTC)</th><th>Players</th><th>New</th><th>Accounts</th><th>Guests</th><th>Matches</th><th>Online</th><th>Came back next day</th><th>…after a week</th></tr>
        ${days.slice().reverse().map((d) => `<tr><td>${esc(short(d.day))}</td><td>${d.n}</td><td>${d.new}</td><td>${d.acc}</td><td>${d.guest}</td><td>${d.online + d.solo}</td><td>${d.online}</td><td>${pct(d.d1)}</td><td>${pct(d.d7)}</td></tr>`).join('')}</table></div>`;
  }

  // ---- 🐞 Bugs: errors games sent by themselves ----
  function bugsHtml(bugs) {
    if (!bugs.length) return '<div class="card">No bug reports. 🎉</div>';
    const top = (o) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${esc(PLAT[k] || k)} ${n}`).join(' · ');
    return bugs.map((b) => `<div class="card">
        <div class="row"><span class="tag ${b.done ? '' : 'bad'}">${b.done ? '✓ fixed' : b.back ? 'happened again' : b.kind === 'crash' ? 'crash screen' : 'error'}</span>
          <b style="overflow-wrap:anywhere">${esc(b.msg)}</b></div>
        <div class="small">${esc(b.where || 'unknown place')} · <b>${b.who}</b> player${b.who === 1 ? '' : 's'} · ${b.n} time${b.n === 1 ? '' : 's'} · first ${when(b.first)} · last ${when(b.last)}</div>
        <div class="small">Versions: ${top(b.vers)} · on: ${top(b.plats)} · screen: ${top(b.states)}</div>
        ${b.stack ? `<details><summary class="small">Details for the developer</summary><pre>${esc(b.stack)}</pre></details>` : ''}
        ${b.done ? '' : `<div class="row" style="margin-top:6px"><button class="good" data-bugdone="${esc(b.sig)}">✓ Mark fixed</button></div>`}
      </div>`).join('');
  }

  function bind(root) {
    root.querySelectorAll('[data-bugdone]').forEach((b) => (b.onclick = () => act({ do: 'bugdone', sig: b.dataset.bugdone })));
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
