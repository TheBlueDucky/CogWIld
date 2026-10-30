// Cogwild — pings (v1.10): mark a spot for your team without typing (matches are quick chat only).
// Tap Z (📍 on phones, right stick on a controller): a smart ping where you aim: an enemy, loot, or "go here".
// Hold Z: a ping wheel (move the mouse toward Attack / Defend / Help me / Careful, let go to send).
// Team-mates see a marker in the world, on the minimap and in the feed; bots on your team go there.
(function () {
  const CW = window.CW;
  const V3 = THREE.Vector3;
  const $ = (id) => document.getElementById(id);
  const r1 = (v) => Math.round(v * 10) / 10;
  const HOLD = 0.25, LIFE = 7, GAP = 0.7;

  CW.PINGS = {
    go: { icon: '📍', text: 'Go here', color: 0x5ce1ff },
    enemy: { icon: '🎯', text: 'Enemy here', color: 0xff4d6d },
    loot: { icon: '🧰', text: 'Loot here', color: 0xffd23f },
    attack: { icon: '⚔', text: 'Attack here', color: 0xff7b00 },
    defend: { icon: '🛡', text: 'Defend here', color: 0x4cc9f0 },
    help: { icon: '🆘', text: 'Help me!', color: 0xff3b5c },
    careful: { icon: '⚠', text: 'Careful!', color: 0xffbe0b },
  };
  const WHEEL = ['attack', 'defend', 'help', 'careful']; // up, right, down, left

  class Pings {
    constructor(game) {
      this.game = game;
      this.list = []; // { c, kind, at, follow, until, mesh, el }
      this.downT = 0;
      this.wheel = null; // { x, y, pick }
      this.last = -9;
    }
    clear() {
      for (const p of this.list) this.drop(p);
      this.list = [];
      this.closeWheel();
    }
    drop(p) { this.game.scene.remove(p.mesh); if (p.el) p.el.remove(); }

    // what the player is aiming at: an enemy close to the line of sight, loot / a chest near the aim point, or the ground
    smart() {
      const g = this.game, me = g.player;
      const from = g.camera.position.clone(), dir = new V3();
      g.camera.getWorldDirection(dir);
      let best = null, bd = 4;
      for (const c of g.combatants) {
        if (!c.alive || CW.sameTeam(c, me)) continue;
        const b = c.mech && c.mech.alive ? c.mech : c.pilot && c.pilot.alive ? c.pilot : null;
        if (!b) continue;
        const rel = b.pos.clone().sub(from), t = rel.dot(dir);
        if (t < 2 || t > 220) continue;
        const off = rel.addScaledVector(dir, -t).length() - (b === c.mech ? c.mech.radius * 0.6 : 0);
        if (off < bd + t * 0.01) { bd = off; best = c; }
      }
      if (best) return { kind: 'enemy', at: (best.mech && best.mech.alive ? best.mech : best.pilot).pos.clone(), follow: best };
      const at = (g.cam.aim && g.cam.aim.clone()) || from.clone().addScaledVector(dir, 40);
      const lootNear = g.loot.items.some((it) => it.pos.distanceTo(at) < 8) || g.chests.items.some((ch) => !ch.opened && ch.pos.distanceTo(at) < 9) || g.pickups.items.some((it) => it.active && it.pos.distanceTo(at) < 6);
      return { kind: lootNear ? 'loot' : 'go', at };
    }
    send(kind, at, follow) {
      const g = this.game, me = g.player;
      if (g.time - this.last < GAP) return;
      this.last = g.time;
      if (kind === 'help') { const b = me.mech && me.mech.alive ? me.mech : me.pilot; if (b) at = b.pos.clone(); }
      this.show(me, kind, at, follow);
      if (g.net.active) g.net.events.push({ k: 'ping', c: me.netId, p: kind, x: r1(at.x), y: r1(at.y), z: r1(at.z), f: follow ? follow.netId : undefined });
    }
    onRemote(e, c) {
      if (!c || !CW.PINGS[e.p]) return;
      const g = this.game;
      const follow = e.f !== undefined ? g.net.byId.get(e.f) : null;
      this.show(c, e.p, new V3(+e.x || 0, +e.y || 0, +e.z || 0), follow);
    }
    // team-mates' pings (and your own) show; bots on your team answer them
    show(c, kind, at, follow) {
      const g = this.game, P = CW.PINGS[kind];
      if (!g.player || !(c === g.player || (g.teamMode && CW.sameTeam(c, g.player)))) return;
      const mine = this.list.filter((p) => p.c === c);
      if (mine.length >= 3) { this.drop(mine[0]); this.list.splice(this.list.indexOf(mine[0]), 1); }
      const mesh = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: P.color, transparent: true, opacity: 0.85, depthWrite: false });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 12).rotateX(Math.PI), mat);
      cone.position.y = 4;
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 28).rotateX(-Math.PI / 2), mat);
      ring.position.y = 0.2;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 30, 6, 1, true), new THREE.MeshBasicMaterial({ color: P.color, transparent: true, opacity: 0.3, depthWrite: false }));
      beam.position.y = 15;
      mesh.add(cone, ring, beam);
      mesh.position.copy(at);
      g.scene.add(mesh);
      const el = document.createElement('div');
      el.className = 'ping-tag';
      el.style.setProperty('--pc', '#' + P.color.toString(16).padStart(6, '0'));
      el.innerHTML = `<b>${P.icon}</b><span></span>`;
      el.querySelector('span').textContent = `${c.isPlayer ? 'You' : c.name}: ${P.text}`;
      $('tags').appendChild(el);
      const p = { c, kind, at: at.clone(), follow, until: g.time + LIFE, mesh, cone, ring, el };
      this.list.push(p);
      g.feed(`${P.icon} ${c.isPlayer ? 'You' : CW.esc(c.name)}: ${P.text}`, kind === 'help' || kind === 'careful' ? 'bad' : '');
      g.audio.tone(kind === 'enemy' || kind === 'careful' || kind === 'help' ? 880 : 1180, 0.08, 'sine', 0.14, 1.3);
      setTimeout(() => g.audio.tone(kind === 'enemy' ? 660 : 1560, 0.1, 'sine', 0.12), 90);
      // bots on the team: go there (attack / defend / go / loot), come help, or go after the enemy
      for (const o of g.combatants) {
        if (o === c || o.isPlayer || o.human || !o.ai || !o.alive || !CW.sameTeam(o, c) || !g.net.owns(o) || kind === 'careful') continue;
        if (Math.random() < 0.35) continue; // not all of them at once
        if (kind === 'enemy' && follow) {
          const b = follow.mech && follow.mech.alive ? follow.mech : follow.pilot;
          if (b) { o.ai.target = { c: follow, pos: b.pos, mech: follow.mech && follow.mech.alive ? follow.mech : null, pilot: follow.mech && follow.mech.alive ? null : follow.pilot }; o.ai.retarget = 5; }
        } else { o.ai.pingGoal = p.at.clone(); o.ai.pingT = g.time + 9; }
      }
    }

    // the wheel (hold Z)
    openWheel() {
      let el = $('pingWheel');
      if (!el) {
        el = document.createElement('div');
        el.id = 'pingWheel';
        el.innerHTML = WHEEL.map((k, i) => `<div class="pw-opt pw-${i}" data-k="${k}"><b>${CW.PINGS[k].icon}</b><span>${CW.PINGS[k].text}</span></div>`).join('') + '<i class="pw-dot"></i>';
        $('hud').appendChild(el);
      }
      el.classList.remove('hidden');
      this.wheel = { x: 0, y: 0, pick: null, el };
      this.paint();
    }
    wheelMove(dx, dy) {
      const w = this.wheel;
      if (!w) return;
      w.x = Math.max(-80, Math.min(80, w.x + dx));
      w.y = Math.max(-80, Math.min(80, w.y + dy));
      const d = Math.hypot(w.x, w.y);
      w.pick = d < 18 ? null : WHEEL[Math.abs(w.x) > Math.abs(w.y) ? (w.x > 0 ? 1 : 3) : w.y < 0 ? 0 : 2];
      this.paint();
    }
    paint() {
      const w = this.wheel;
      w.el.querySelectorAll('.pw-opt').forEach((o) => o.classList.toggle('on', o.dataset.k === w.pick));
      w.el.querySelector('.pw-dot').style.transform = `translate(${w.x * 0.6}px, ${w.y * 0.6}px)`;
    }
    closeWheel() {
      if (this.wheel) this.wheel.el.classList.add('hidden');
      this.wheel = null;
    }

    update(dt) {
      const g = this.game;
      const z = !!g.keys.KeyZ && g.state === 'match' && !g.paused && !g.ended && !g.spectator && g.countdown <= 0 && g.player && g.player.alive;
      if (z) {
        this.downT += dt;
        if (this.downT >= HOLD && !this.wheel && !g.touch.on) this.openWheel();
      } else if (this.downT > 0) {
        // let go: the wheel's pick, or a quick smart ping
        if (this.wheel) { const k = this.wheel.pick; this.closeWheel(); if (k) { const s = this.smart(); this.send(k, s.at); } }
        else if (g.state === 'match' && g.player) { const s = this.smart(); this.send(s.kind, s.at, s.follow); }
        this.downT = 0;
      }
      // markers: follow a pinged enemy, fade out, and the label on screen
      const w = g.view ? g.view.w : innerWidth, h = g.view ? g.view.h : innerHeight, zoom = g.uiZoom || 1;
      const v = new V3();
      for (let i = this.list.length - 1; i >= 0; i--) {
        const p = this.list[i];
        if (g.time > p.until) { this.drop(p); this.list.splice(i, 1); continue; }
        if (p.follow) {
          const b = p.follow.mech && p.follow.mech.alive ? p.follow.mech : p.follow.pilot && p.follow.pilot.alive ? p.follow.pilot : null;
          if (b) p.at.copy(b.pos);
        }
        p.mesh.position.copy(p.at);
        p.cone.position.y = 4 + Math.sin(g.time * 5) * 0.4;
        p.ring.scale.setScalar(1 + ((g.time * 1.5) % 1) * 0.6);
        const left = p.until - g.time;
        p.mesh.visible = left > 1 || Math.floor(g.time * 8) % 2 === 0;
        v.copy(p.at); v.y += 6;
        const dist = g.camera.position.distanceTo(v);
        v.project(g.camera);
        if (v.z > 1) { p.el.style.display = 'none'; continue; }
        // labels stay on screen at the edges, so you can find the ping
        const x = Math.max(0.04, Math.min(0.96, v.x * 0.5 + 0.5)), y = Math.max(0.06, Math.min(0.92, -v.y * 0.5 + 0.5));
        p.el.style.display = 'flex';
        p.el.style.transform = `translate(${(x * w) / zoom}px, ${(y * h) / zoom}px) translate(-50%, -100%)`;
        p.el.dataset.d = Math.round(dist) + ' m';
      }
    }
    minimap(ctx, toMap) {
      for (const p of this.list) {
        const [x, y] = toMap(p.at.x, p.at.z);
        ctx.strokeStyle = '#' + CW.PINGS[p.kind].color.toString(16).padStart(6, '0');
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 5 + Math.sin(this.game.time * 6) * 1.5, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
  }

  CW.Pings = Pings;
})();
