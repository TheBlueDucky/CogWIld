// Cogwild — web-portal adapter (CrazyGames / Poki / none)
// When the game runs on a portal, that portal's SDK script must be added to index.html
// (see LAUNCH.md). Without an SDK every call is a safe no-op, so the game works anywhere.
(function () {
  const CW = window.CW;

  const Platform = {
    name: 'web',
    ready: false,
    hasRewarded: false,

    async init() {
      try {
        if (window.CrazyGames && window.CrazyGames.SDK) {
          this.name = 'crazygames';
          this.sdk = window.CrazyGames.SDK;
          if (this.sdk.init) await this.sdk.init();
          this.hasRewarded = true;
        } else if (window.PokiSDK) {
          this.name = 'poki';
          this.sdk = window.PokiSDK;
          await this.sdk.init();
          this.hasRewarded = true;
        }
      } catch (e) {
        console.warn('Platform SDK failed to start, continuing without it', e);
        this.name = 'web';
        this.hasRewarded = false;
      }
      this.ready = true;
    },

    loadingDone() {
      try {
        if (this.name === 'crazygames') this.sdk.game.loadingStop && this.sdk.game.loadingStop();
        if (this.name === 'poki') this.sdk.gameLoadingFinished();
      } catch (e) { /* ignore */ }
    },

    gameplayStart() {
      try {
        if (this.name === 'crazygames') this.sdk.game.gameplayStart();
        if (this.name === 'poki') this.sdk.gameplayStart();
      } catch (e) { /* ignore */ }
    },

    gameplayStop() {
      try {
        if (this.name === 'crazygames') this.sdk.game.gameplayStop();
        if (this.name === 'poki') this.sdk.gameplayStop();
      } catch (e) { /* ignore */ }
    },

    happyTime() {
      try { if (this.name === 'crazygames') this.sdk.game.happytime(); } catch (e) { /* ignore */ }
    },

    // Break between matches. Resolves when it is safe to continue.
    midgameAd(game) {
      return this.ad('midgame', game).then(() => true);
    },

    // Resolves true only if the player watched the whole ad.
    rewardedAd(game) {
      if (!this.hasRewarded) return Promise.resolve(false);
      return this.ad('rewarded', game);
    },

    ad(kind, game) {
      if (this.name === 'web') return Promise.resolve(false);
      const mute = () => game && game.audio.ctx && game.audio.ctx.suspend();
      const unmute = () => game && game.audio.ctx && game.audio.ctx.resume();
      return new Promise((resolve) => {
        try {
          if (this.name === 'crazygames') {
            this.sdk.ad.requestAd(kind, { adStarted: mute, adFinished: () => { unmute(); resolve(true); }, adError: () => { unmute(); resolve(false); } });
          } else if (this.name === 'poki') {
            mute();
            const p = kind === 'rewarded' ? this.sdk.rewardedBreak() : this.sdk.commercialBreak();
            p.then((ok) => { unmute(); resolve(kind === 'rewarded' ? !!ok : true); });
          } else resolve(false);
        } catch (e) { unmute(); resolve(false); }
      });
    },
  };

  CW.Platform = Platform;
})();
