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
  const V = ((document.currentScript && document.currentScript.src.match(/\?v=\d+/)) || [''])[0]; // the same cache buster as this file
  const KEYS = ["PLAY", "find a match", "Shop", "Workshop", "Challenges", "Achievements", "Replays", "Help", "Friends", "Clubs", "Leaderboard", "Trophy Road", "News", "Gallery", "Settings", "Log in", "Sign up", "Log in for trophies", "Pilot name", "Change", "Any arena", "Featured today", "Weekend Cup", "Cog Pass", "Challenge", "see all ›", "Daily gift", "Free gift!", "Tap to claim your daily reward", "Coins: spend them in the Shop", "Your profile and account", "Pick the mode and arena you want to play", "Find a match on your arena", "Welcome back", "Play as guest", "Menu", "Back", "Close (Esc)", "Cancel", "Done", "Claim", "Claim!", "Buy", "Play it", "Info", "Delete", "Loading…", "Refresh", "Send", "Join", "Public", "Leave", "Skip", "Continue", "Yes", "No", "OK", "Back to menu", "Back to the menu", "Tier {n} / {n}", "ends in {n}d {n}h", "ends in {n}h {n}m", "ends in {n}m", "Level {n}", "Level", "Rank", "Coins", "Trophies", "Daily challenges", "How to play", "What's new", "Profile", "Trophy road", "Pick a mode and arena", "Level and ranks", "Stats", "Seasonal event", "Mech gallery", "Player", "Workshop Clash", "Rush Build", "King of the Hill", "Gold Rush", "Bounty Hunt", "Combat Race", "Survival", "Boss Battle", "Ranked", "Mode", "Arena", "Duel", "Squads", "Quads", "Free-for-all", "Solo", "Squad", "You alone", "{n} players", "{n} racers", "You + {n} bots", "Choose a game mode", "Pick a mode, then how many players.", "Build from scratch in the match", "Use the mech you built in the lobby", "Hold the zone · respawns on", "Grab the most gold · respawns on", "Endless waves · bring your mech", "Take down the giant Titan", "Race", "Practice vs bots", "Play with friends (private room)", "Tutorial", "Play with friends", "Canyon Lake", "Frost Isles", "Volcano Rift", "Desert Mesa", "Toxic Swamp", "Neon City", "Jungle Temple", "Scrap Yard", "Turbo Speedway", "Shipwreck Bay", "Moon Base", "Meadows, a lake, a canyon river and a mountain.", "Snowy islands linked by bridges across an icy sea.", "A lava moat around a smoking volcano. Lava burns!", "Dunes and tall mesas (each has one ramp up), plus a small oasis.", "Mud islands in glowing toxic sludge. The sludge eats mechs, slowly.", "A street grid with buildings to climb or fly over. A plaza in the middle.", "A river, thick palms and a giant stepped temple to fight over.", "Junk heaps to climb, a flooded pit, a crane rail and the compactor ring in the middle.", "A banked race oval with a big jump on the back straight, an infield hill and grandstands.", "A tropical island round a bay with a pirate wreck, islets to sail to and a lighthouse.", "Craters and low gravity: jump higher and fly further. The Earth hangs in a black sky.", "The fastest match: one of the {n} arenas in rotation right now.", "In rotation now (Any arena):", "changes in {n}h {n}m", "NEW", "Time:", "Day", "Sunset", "Night", "Random", "Bots:", "Easy", "Normal", "Hard", "Pick a mode and an arena, then press", "You're matched with players who picked the same; after {n} seconds bots fill the empty seats.", "Unlocks at {n} trophies (your best).", "Gadget", "{n} uses a match · G /", "Repair Kit", "Proximity Mine", "Jump Jets", "Smoke Screen", "Fix about {n}% of your mech at once", "Drop a mine behind you: it blows up under the first enemy that comes close", "A big leap up and forward: escape, or get on top of things", "A smoke cloud: bots lose you for {n} s and you get {n} s of turbo", "best {n} matches count", "Your best {n} matches count", "Every weekend, Friday {n}:{n} to Sunday {n}:{n} UTC · next in {n}d {n}h", "Searching for players…", "Connecting…", "Waiting…", "Ready", "Ready up", "Bolts", "Test drive", "Blueprints", "Save", "Save copy", "Share code", "Paste code", "Undo", "Redo", "Mirror: ON", "Mirror: OFF", "View", "Clear", "Paint", "Paint your mech", "My blueprints", "Nothing saved yet.", "Example mechs", "Parts", "Mass", "Total HP", "Damage/s", "Sinks (crawls on the bottom)", "Can't fly", "Fix the red errors first", "Drive your mech in the arena (T)", "Undo (Ctrl+Z)", "Redo (Ctrl+Y)", "Mirror building (M)", "Reset camera (F)", "Back to Workshop (T)", "Back to the gallery (T)", "Control", "Structure", "Land", "Water", "Air", "Weapon", "Utility", "Decor", "Core", "Camera", "Frame", "Armor", "Car Body", "Flat Panel", "Nose", "Cabin", "Fender", "Spoiler", "Headlights", "Exhaust", "Wheel", "Big Wheel", "Leg", "Float", "Propeller", "Wing", "Rotor", "Jet", "Engine", "Cannon", "Rocket Pod", "Laser", "Railgun", "Flamethrower", "Saw Blade", "Spikes", "Shield", "Repair Drone", "Booster", "Flag", "Lamp", "Horns", "Body", "Power", "Integrity", "Dash", "READY", "Super", "used up", "Back to the fight", "Restart", "Quit match", "Leave online match", "Skip tutorial", "Hold to get out", "First person (V)", "Chase cam (V)", "CONTESTED", "Nobody holds the hill", "VICTORY!", "DEFEAT", "Mechs wrecked", "Eliminations", "Play again", "Replay", "Repairing…", "Walk back to your mech to repair it", "Stay alive!", "FIGHT", "Red", "Blue", "Log in to earn trophies", "SUPER ready! Press X / right-click", "Supers charge {n}× faster", "Hold Space to climb · C to fly down", "Account", "Display", "Controls", "Keys", "Touch screen", "Sound", "Voice chat", "Chat", "Save data", "Support", "Language", "Graphics quality", "Auto (recommended)", "Low (fast, for older laptops and phones)", "Medium", "High (shadows + max detail)", "Field of view", "Fullscreen", "Toggle fullscreen", "Screen shake", "Floating damage numbers", "Show FPS counter", "Look sensitivity (mouse, stick, touch)", "Invert look up/down", "Auto-steer: W drives toward where you look (off = steer with A/D like a car)", "Bot difficulty", "Reset keys", "Drive forward / walk", "Reverse / walk back", "Turn left / step left", "Turn right / step right", "Fly up / jump", "Fly down / dive (also Q, Ctrl)", "Super (also right-click)", "Exit / enter mech", "Repair (hold, on foot)", "Unstuck", "Switch camera", "Scoreboard", "Save clip", "On-screen controls", "Auto (on for touch screens)", "Always on", "Off", "On", "Button size", "Vibration (phones and tablets)", "Volume", "Music", "Music volume", "Tell me when a friend comes online", "Microphone", "Default microphone", "Speakers / headphones", "Default speakers", "Voice volume", "Your mic", "Who you hear", "My party and my match", "My party only", "Free chat: type anything", "Quick chat only (for kids): ready-made messages, no voice chat", "Blocked players", "Back up save", "Restore save", "Reset all progress…", "Need help? Contact us", "Email us", "Copy email", "Playing as a guest (progress saved on this device only)", "No key", "Welcome to Cogwild", "Continue with Google", "Username", "Password", "Confirm password", "Email", "Create account", "Forgot your password?", "Show passwords", "By signing up you agree to the", "Privacy Policy", "Log in / Sign up", "Log in or sign up", "Send me a code", "Code", "Verify", "Use a different email", "Choose a new password", "New password", "Save and log in", "Playing as a guest: your progress is saved on this device only. Log in to keep it on every device and to get trophies, friends, clubs and voice chat.", "Later", "Daily deals", "new deals in {n}h {n}m", "Mech finishes", "Wreck effects", "what you see when you wreck an enemy", "Paints", "Dash trails", "Avatars", "log in to wear them", "Equipped", "Owned", "Unlocked", "Buy it?", "Not enough coins", "Buy for {n}", "{n} / {n} unlocked. Each one pays coins.", "First Steps", "Play your first match", "Winner!", "Win a match", "Champion", "Win {n} matches", "Scrapper", "Demolisher", "Scrap Lord", "Wreck {n} mechs", "Pilot Hunter", "Eliminate {n} pilots", "Battering Ram", "Land {n} spike rams", "Zoomies", "Dash {n} times", "Sky Captain", "Fly for {n} minutes total", "Deep Diver", "Spend {n} minutes in water", "Hat Trick", "Get a {n}-wreck streak", "Collector", "Grab {n} power-ups", "Treasure Hunter", "Open {n} loot chests", "Last Stand", "Reach wave {n} in Survival", "Hill King", "Win a King of the Hill match", "Gold Digger", "Speed Demon", "Win a Combat Race", "Titan Slayer", "Defeat the Titan", "World Tour", "Play a match on every map", "Mode Master", "Play every game mode", "All-Rounder", "Play both Rush Build and Workshop Clash", "Mega Build", "Win with a mech of {n}+ parts", "Untouchable", "Win without losing a single part", "New challenges every day. Complete them in any mode.", "Blow off {n} enemy parts", "Play {n} Rush Build matches", "Play {n} Workshop Clash matches", "Use your gadget {n} times", "Spend {n} seconds in water", "Win {n} match", "Play on {n} different maps", "Matches played", "Wins", "Win rate", "Pilots eliminated", "Times eliminated", "Best wreck streak", "Enemy parts blown off", "Dashes", "Time flying", "Time in water", "Coins earned", "Watch", "Keep it for good", "Stop keeping it", "Save as a file", "Open a replay file", "Left the match", "Exit", "Follow", "Orbit", "Free", "Timeline", "Play or pause", "Speed", "Previous mech", "Next mech", "Hide the controls", "Show the controls", "No replays yet: play a match and it shows up here.", "Your last {n} matches are kept on this device.", "Space play/pause · ←/→ {n} s · ↑/↓ speed · Tab next mech · C camera (drag to look around, WASD to fly) · H hide", "Trending", "Top", "New", "Liked", "Mine", "Share a mech", "All", "Mixed", "Search mechs or makers", "Show more", "Copy to my Workshop", "Try it", "Like", "Report", "Remove from the gallery", "likes", "copies", "parts", "health", "firepower", "Stands still", "No mechs here yet. Be the first to 🌍 share one!", "Mechs you ❤ show up here.", "No mechs match that search.", "Share it", "Name", "Everyone can see it, like it and copy it. Pick one of yours:", "Why?", "Rude name", "Rude shape", "Copied from me", "Something else", "Haunted Harvest", "Winter Wonderland", "Mech Hearts", "Spring Bloom", "Summer Splash", "Every year", "These items are never sold in the Shop: get them before the event ends!", "event points", "every match +{n}", "every daily challenge +{n}", "How it works", "Last cup", "One mode all weekend, any arena, bots fill empty seats", "Only your best {n} matches add up: more tries only help", "Nobody has played yet. Be the first!", "your place of {n}", "points (best {n})", "matches played", "The Weekend Cup is for players with an account.", "Picked", "Your reward is ready!", "cup points", "Online", "Offline", "Add friend", "Party", "Invite", "Leave the party", "You are playing as a guest.", "Log in to add friends and make a party.", "Log in to join a club.", "World", "Change username", "Log out", "Log in to share your mechs", "Log in to like mechs", "Log in to play the Weekend Cup", "Slow down a little", "Thanks. We got your report.", "Quick chat only is on (Settings › Chat)", "That mech is no longer in the gallery", "Removed from the gallery", "Turn your phone sideways to play Cogwild", "Oops, something broke", "Copy report", "Use voice chat?", "Keep it off", "Turn on voice chat", "Type a message…", "Quick chat only"];
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
  s.src = `js/lang/${I.lang}.js${V}`;
  s.onload = () => {
    const list = CW.LANG_DATA[I.lang];
    if (!Array.isArray(list)) return;
    I.dict = new Map();
    KEYS.forEach((k, i) => { if (list[i]) I.dict.set(k, list[i]); });
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  };
  document.head.appendChild(s);
})();
