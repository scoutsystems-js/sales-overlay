// Runs INSIDE electron (see electron-render.js). argv: [html file, probe expression, width]
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const file = process.argv[2], probe = process.argv[3], width = parseInt(process.argv[4], 10) || 1400;
  const win = new BrowserWindow({ show: false, width: width, height: 900, webPreferences: { offscreen: true, sandbox: false } });
  try {
    await win.loadFile(file);
    const out = await win.webContents.executeJavaScript('(async () => JSON.stringify(await (' + probe + ')))()');   /* a probe may be async (an image to decode) */
    process.stdout.write('@@RESULT@@' + out + '\n');
    app.exit(0);
  } catch (e) { process.stderr.write(String(e && e.stack || e)); app.exit(2); }
});
