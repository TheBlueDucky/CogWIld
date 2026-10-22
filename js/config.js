// Cogwild — where the online server lives.
// Leave SERVER_URL empty when the game is served by the Cogwild server itself (the normal setup:
// players open https://your-domain/ and the game talks to wss://your-domain/ws).
// Set it only when the game files are hosted somewhere else (itch.io, CrazyGames, Poki, the desktop app):
//   CW.SERVER_URL = 'wss://play.example.com/ws';
// PUBLIC_URL is the page your invite links point to (empty = the page the player is on).
(function () {
  const CW = (window.CW = window.CW || {});
  CW.SERVER_URL = '';
  CW.PUBLIC_URL = '';
})();
