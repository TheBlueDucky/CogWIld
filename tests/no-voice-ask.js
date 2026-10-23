// Tests that aren't about voice chat answer the game's first-time "Use voice chat?" question with "Keep it off".
module.exports = (win) => {
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(`setInterval(() => { const a = document.getElementById('vcAsk'); if (a && !a.classList.contains('hidden')) document.getElementById('vcNo').click(); }, 150); true`).catch(() => {});
  });
};
