// Cogwild — controller support (standard Xbox / PlayStation layout via the Gamepad API)
// In matches the pad drives the same virtual keys as the keyboard. In menus the D-pad moves
// between buttons and A presses them.
(function () {
  const CW = window.CW;
  const DEAD = 0.22;

  // button index → keyboard code it acts like (held)
  const HOLD = { 0: 'Space', 1: 'KeyC', 6: 'KeyC', 4: 'KeyR', 8: 'Tab' };
  // button index → keyboard code it taps (pressed once)
  const TAP = { 2: 'ShiftLeft', 3: 'KeyE', 5: 'KeyV', 9: 'Escape', 12: 'F8' };

  class Gamepad {
    constructor(game) {
      this.game = game;
      this.prev = [];
      this.held = {};
      this.connected = false;
      window.addEventListener('gamepadconnected', (e) => {
        this.connected = true;
        game.toast(`🎮 Controller connected: ${e.gamepad.id.split('(')[0].trim()}`);
      });
      window.addEventListener('gamepaddisconnected', () => {
        this.connected = false;
        this.release();
        game.toast('🎮 Controller disconnected');
      });
    }

    pad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) if (p && p.connected) return p;
      return null;
    }

    release() {
      for (const code of Object.keys(this.held)) this.game.keys[code] = false;
      this.held = {};
      this.game.mouse.left = false;
    }

    setHeld(code, on) {
      const g = this.game;
      if (on) { if (!g.keys[code]) g.pressed[code] = true; g.keys[code] = true; this.held[code] = true; }
      else if (this.held[code]) { g.keys[code] = false; delete this.held[code]; }
    }

    tap(code) {
      const g = this.game;
      g.pressed[code] = true;
      // Escape / V / F8 are handled by keydown listeners, so send a real key event for those
      if (code === 'Escape' || code === 'KeyV' || code === 'F8') window.dispatchEvent(new KeyboardEvent('keydown', { code }));
    }

    update(dt) {
      const p = this.pad();
      if (!p) return;
      const g = this.game;
      const b = p.buttons.map((x) => x.pressed || x.value > 0.5);
      const down = (i) => b[i] && !this.prev[i];
      const ax = (i) => (Math.abs(p.axes[i] || 0) > DEAD ? p.axes[i] : 0);

      if (g.state === 'match' && !g.paused) {
        // left stick: drive / walk
        const lx = ax(0), ly = ax(1);
        this.setHeld('KeyW', ly < -0.3);
        this.setHeld('KeyS', ly > 0.3);
        this.setHeld('KeyA', lx < -0.3);
        this.setHeld('KeyD', lx > 0.3);
        // right stick: look
        const rx = ax(2), ry = ax(3);
        const sens = 2.6 * g.settings.sens;
        g.mouse.dx += (rx * sens * dt) / 0.0023 / g.settings.sens;
        g.mouse.dy += (ry * sens * dt) / 0.0023 / g.settings.sens;
        // triggers & buttons
        const fire = b[7];
        if (fire) g.mouse.left = true;
        else if (this.prev[7]) g.mouse.left = false;
        for (const [i, code] of Object.entries(HOLD)) this.setHeld(code, !!b[i]);
        for (const [i, code] of Object.entries(TAP)) if (down(+i)) this.tap(code);
      } else {
        this.release();
        if (down(9) && g.state === 'match') this.tap('Escape');
        this.menuNav(down);
      }
      this.prev = b;
    }

    // D-pad / left stick moves focus between visible buttons, A clicks, B goes back
    menuNav(down) {
      const buttons = [...document.querySelectorAll('button')].filter((el) => el.offsetParent !== null && !el.disabled);
      if (!buttons.length) return;
      let i = buttons.indexOf(document.activeElement);
      const move = (d) => {
        i = i < 0 ? 0 : (i + d + buttons.length) % buttons.length;
        buttons[i].focus();
        buttons[i].classList.add('pad-focus');
        setTimeout(() => buttons[i] && buttons[i].classList.remove('pad-focus'), 400);
      };
      const p = this.pad();
      const ly = p ? p.axes[1] || 0 : 0;
      this.stickCd = Math.max(0, (this.stickCd || 0) - 1);
      if (down(13) || down(15) || (ly > 0.6 && !this.stickCd)) { move(1); this.stickCd = 12; }
      if (down(12) || down(14) || (ly < -0.6 && !this.stickCd)) { move(-1); this.stickCd = 12; }
      if (down(0) && document.activeElement && document.activeElement.tagName === 'BUTTON') document.activeElement.click();
      if (down(1)) {
        const back = ['panelClose', 'modesBack', 'pickerBack', 'wsBack', 'resMenu'].map((id) => document.getElementById(id)).find((el) => el && el.offsetParent !== null);
        if (back) back.click();
      }
    }
  }

  CW.Gamepad = Gamepad;
})();
