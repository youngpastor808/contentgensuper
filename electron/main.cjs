
let disposeContextMenu;

const { app, BrowserWindow, ipcMain, dialog, Menu, Notification, powerSaveBlocker, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { fork, spawn } = require('child_process');

// Stability and memory configuration for Chromium Renderer
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-webgl');
app.commandLine.appendSwitch('enable-webgl2-compute-context');

let mainWindow;
let exportWorkerWindow = null;
let serverProcess;
let globalPort = 3000;
let lastServerErr = '';
let isQuitting = false;

function getSplashHtml(port) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ContentGen AI</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      width: 100vw;
      height: 100vh;
      background: #090d16;
      color: #f1f5f9;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      user-select: none;
      -webkit-app-region: drag;
    }
    .card {
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(56, 189, 248, 0.2);
      border-radius: 16px;
      padding: 40px 48px;
      display: flex;
      flex-direction: column;
      align-items: center;
      box-shadow: 0 20px 40px rgba(0,0,0,0.6);
      text-align: center;
      max-width: 420px;
    }
    .logo {
      width: 64px;
      height: 64px;
      margin-bottom: 20px;
      filter: drop-shadow(0 0 16px rgba(56, 189, 248, 0.5));
      animation: pulse 2s infinite ease-in-out;
    }
    .title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 6px;
      background: linear-gradient(135deg, #ffffff 0%, #38bdf8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .status {
      font-size: 13px;
      color: #94a3b8;
      margin-bottom: 24px;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(56, 189, 248, 0.2);
      border-top-color: #38bdf8;
      border-radius: 50%;
      animation: spin 0.9s linear infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.9; }
      50% { transform: scale(1.05); opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="card">
    <svg class="logo" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
      <polyline points="2 17 12 22 22 17"></polyline>
      <polyline points="2 12 12 17 22 12"></polyline>
    </svg>
    <div class="title">ContentGen AI</div>
    <div class="status" id="status-msg">Starting high-performance video engine...</div>
    <div class="spinner"></div>
  </div>
</body>
</html>`)}`;
}

function createWindow(port = globalPort) {
  globalPort = port;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true, // Show immediately so desktop app never runs as an invisible background ghost
    backgroundColor: '#090d16',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  // Load sleek startup splash immediately while backend initializes
  mainWindow.loadURL(getSplashHtml(port)).catch(() => {});

  if (disposeContextMenu) {
    try { disposeContextMenu(); } catch (e) {}
  }
  import('electron-context-menu').then(m => {
    const fn = (m && m.default) ? m.default : m;
    if (typeof fn === 'function' && mainWindow && !mainWindow.isDestroyed()) {
      disposeContextMenu = fn({
        window: mainWindow,
        showSaveImageAs: true,
        showInspectElement: true
      });
    }
  }).catch(err => console.error('Failed to load electron-context-menu', err));

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Renderer crash / termination visibility handlers
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    if (isQuitting) return;
    console.error('========================================');
    console.error('[ELECTRON] RENDERER PROCESS GONE');
    console.error('========================================');
    console.error('[ELECTRON] Reason:', details.reason);
    console.error('[ELECTRON] Exit code:', details.exitCode);
    console.error('[ELECTRON] Details:', details);

    let reasonText = details.reason;
    if (details.reason === 'oom') {
      reasonText = 'Out of Memory. The renderer exceeded available memory.';
    } else if (details.reason === 'crashed') {
      reasonText = 'Renderer/GPU process crashed.';
    } else if (details.reason === 'killed') {
      reasonText = 'The operating system killed the renderer process.';
    } else if (details.reason === 'launch-failed') {
      reasonText = 'Renderer failed to launch.';
    }

    try {
      dialog.showErrorBox(
        'Video Export Process Error',
        `The video renderer stopped unexpectedly.\n\n` +
        `Reason: ${reasonText}\n` +
        `Exit Code: ${details.exitCode}\n\n` +
        `Check the developer console/log for export diagnostics.`
      );
    } catch (error) {
      console.error('[ELECTRON] Failed to display renderer error:', error);
    }
  });

  mainWindow.webContents.on('crashed', () => {
    if (!isQuitting) {
      console.error('[ELECTRON] RENDERER CRASHED');
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    if (isQuitting) return;
    console.warn('[ELECTRON] MainWindow webContents became unresponsive. Possible OOM or infinite loop during export.');
    try {
      dialog.showErrorBox(
        'App Unresponsive',
        'The application has become unresponsive. This can happen during heavy exports if system memory (RAM) is exhausted.\n\nPlease check the developer console logs.'
      );
    } catch (e) {}
  });

  // Hide the menu by default
  mainWindow.autoHideMenuBar = true;
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      const isVisible = mainWindow.menuBarVisible;
      mainWindow.setMenuBarVisibility(!isVisible);
    }
  });

  // Intercept target="_blank" and window.open to use the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Intercept standard navigation to external sites to use the default browser
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const parsedUrl = new URL(url);
      if ((parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') && 
          parsedUrl.hostname !== 'localhost' && 
          parsedUrl.hostname !== '127.0.0.1') {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch (err) {
      console.error('Invalid URL during navigation:', err);
    }
  });

  // Set up native OS Application Menu
  const template = [
    {
      label: 'File',
      submenu: [
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];
  
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Load the web app which will be served on the dynamically chosen port
  // Use 127.0.0.1 instead of localhost to avoid IPv6 resolution issues on some systems
  const url = `http://127.0.0.1:${port}`;
  
  let checkAttempts = 0;
  const maxAttempts = 60; // 30 seconds (500ms * 60)
  let loadTriggered = false;

  function showStartupTimeoutError() {
    if (isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
    dialog.showErrorBox(
      'Startup Timeout',
      `The background server at ${url} failed to respond after 30 seconds.\n\n` +
      `Please check whether local firewall software is blocking localhost connections.\n` +
      (lastServerErr ? `\nServer diagnostics:\n${lastServerErr}` : '')
    );
  }

  function checkServerAndLoad() {
    if (loadTriggered || isQuitting || !mainWindow || mainWindow.isDestroyed()) return;
    checkAttempts++;
    const req = http.get(url + '/api/health', (res) => {
      res.resume(); // Consume incoming stream data so socket is released
      if (res.statusCode === 200) {
        loadTriggered = true;
        mainWindow.loadURL(url).catch((err) => {
          console.log('Failed to load url:', err);
          loadTriggered = false;
          if (checkAttempts < maxAttempts && !isQuitting) {
            setTimeout(checkServerAndLoad, 500);
          } else {
            showStartupTimeoutError();
          }
        });
      } else {
        if (checkAttempts < maxAttempts && !isQuitting) {
          setTimeout(checkServerAndLoad, 500);
        } else {
          showStartupTimeoutError();
        }
      }
    });

    req.on('error', (err) => {
      if (checkAttempts % 10 === 0) {
        console.log(`Server not ready yet (${checkAttempts}/${maxAttempts}), retrying in 500ms...`, err.message);
      }
      if (checkAttempts < maxAttempts && !isQuitting) {
        setTimeout(checkServerAndLoad, 500);
      } else {
        showStartupTimeoutError();
      }
    });
  }
  
  checkServerAndLoad();
}



const allowedPaths = new Set();
try {
  const tempDir = app.getPath('temp') || os.tmpdir();
  if (tempDir) allowedPaths.add(path.resolve(tempDir));
} catch (e) {}

function getDefaultWorkspaceRoot() {
  let basePath = null;
  try {
    basePath = app.getPath('documents');
  } catch (e) {}
  if (!basePath) {
    try {
      basePath = app.getPath('home');
    } catch (e) {}
  }
  if (!basePath) {
    try {
      basePath = app.getPath('desktop');
    } catch (e) {}
  }
  if (!basePath) {
    basePath = process.cwd();
  }

  const candidate1 = path.join(basePath, 'ContentGen');
  const candidate2 = path.join(basePath, 'ContentGen AI');
  if (fs.existsSync(candidate1)) return candidate1;
  if (fs.existsSync(candidate2)) return candidate2;
  return candidate1;
}

function ensureWorkspaceStructure(rootPath) {
  const resolvedRoot = path.resolve(rootPath || getDefaultWorkspaceRoot());
  try {
    fs.mkdirSync(resolvedRoot, { recursive: true });
    fs.mkdirSync(path.join(resolvedRoot, 'Projects'), { recursive: true });
    fs.mkdirSync(path.join(resolvedRoot, 'Videos'), { recursive: true });
    fs.mkdirSync(path.join(resolvedRoot, 'Audio'), { recursive: true });
    fs.mkdirSync(path.join(resolvedRoot, 'Assets'), { recursive: true });
  } catch (err) {
    console.error('[ELECTRON] Error creating workspace structure:', err);
  }
  allowedPaths.add(resolvedRoot);
  return resolvedRoot;
}

function getCategoryForPath(filenameOrPath) {
  const lower = String(filenameOrPath || '').toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov') || lower.endsWith('.mkv') || lower.endsWith('.avi')) {
    return 'Videos';
  }
  if (lower.endsWith('.mp3') || lower.endsWith('.wav') || lower.endsWith('.m4a') || lower.endsWith('.ogg') || lower.endsWith('.aac') || lower.endsWith('.flac') || lower.endsWith('.opus') || lower.endsWith('.wma')) {
    return 'Audio';
  }
  if (lower.endsWith('.cgproj') || lower.endsWith('.contentgenai') || lower.endsWith('.cgp')) {
    return 'Projects';
  }
  return 'Assets';
}

ipcMain.handle('show-open-dialog', async (event, options) => {
  try {
    const opts = { ...options };
    if (opts.defaultPath && !path.isAbsolute(opts.defaultPath)) {
      const root = getDefaultWorkspaceRoot();
      ensureWorkspaceStructure(root);
      const cat = getCategoryForPath(opts.defaultPath);
      opts.defaultPath = path.join(root, cat, opts.defaultPath);
    } else if (!opts.defaultPath) {
      const root = getDefaultWorkspaceRoot();
      ensureWorkspaceStructure(root);
      opts.defaultPath = root;
    }
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, opts);
    if (canceled || filePaths.length === 0) return null;
    allowedPaths.add(path.dirname(filePaths[0]));
    allowedPaths.add(filePaths[0]);
    return filePaths[0];
  } catch (error) {
    return null;
  }
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  try {
    const opts = { ...options };
    const root = getDefaultWorkspaceRoot();
    ensureWorkspaceStructure(root);
    
    if (opts.defaultPath && !path.isAbsolute(opts.defaultPath)) {
      const cat = getCategoryForPath(opts.defaultPath);
      opts.defaultPath = path.join(root, cat, opts.defaultPath);
    } else if (!opts.defaultPath) {
      opts.defaultPath = root;
    }
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, opts);
    if (canceled || !filePath) return null;
    allowedPaths.add(path.dirname(filePath));
    allowedPaths.add(filePath);
    return filePath;
  } catch (error) {
    return null;
  }
});

// IPC Handlers for Native File System
ipcMain.handle('save-file', async (event, { data, defaultPath, filters, category }) => {
  try {
    const root = getDefaultWorkspaceRoot();
    ensureWorkspaceStructure(root);

    let resolvedDefaultPath = defaultPath;
    const targetCategory = category || getCategoryForPath(defaultPath);

    if (defaultPath && !path.isAbsolute(defaultPath)) {
      const targetFolder = targetCategory ? path.join(root, targetCategory) : root;
      resolvedDefaultPath = path.join(targetFolder, defaultPath);
    } else if (!defaultPath) {
      resolvedDefaultPath = targetCategory ? path.join(root, targetCategory) : root;
    }

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: resolvedDefaultPath,
      filters
    });
    
    if (canceled || !filePath) return { success: false, canceled: true };
    
    allowedPaths.add(path.dirname(filePath));
    allowedPaths.add(filePath);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, Buffer.from(data));
    return { success: true, filePath };
  } catch (error) {
    console.error('[ELECTRON] save-file error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-file', async (event, { filters }) => {
  try {
    const root = getDefaultWorkspaceRoot();
    ensureWorkspaceStructure(root);

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      defaultPath: path.join(root, 'Projects'),
      properties: ['openFile'],
      filters
    });
    
    if (canceled || filePaths.length === 0) return { success: false, canceled: true };
    
    const filePath = filePaths[0];
    allowedPaths.add(path.dirname(filePath));
    allowedPaths.add(filePath);
    const data = fs.readFileSync(filePath);
    return { success: true, filePath, data: data }; // Returns a Buffer which gets serialized
  } catch (error) {
    return { success: false, error: error.message };
  }
});

let powerSaveBlockerId = null;

ipcMain.handle('power-save-blocker-start', async () => {
  try {
    if (powerSaveBlockerId === null || !powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
    }
    return { success: true, id: powerSaveBlockerId };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('power-save-blocker-stop', async () => {
  try {
    if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
      powerSaveBlocker.stop(powerSaveBlockerId);
      powerSaveBlockerId = null;
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('show-notification', async (event, { title, body } = {}) => {
  if (Notification && typeof Notification.isSupported === 'function' && Notification.isSupported()) {
    new Notification({ title: title || 'ContentGen AI', body: body || '' }).show();
  }
  return { success: true };
});


ipcMain.handle('path-join', (event, ...args) => path.join(...args));

ipcMain.handle('get-known-folder', async (event, name) => {
  try {
    return app.getPath(name);
  } catch (error) {
    console.error(`[ELECTRON] Failed to get known folder '${name}':`, error);
    return null;
  }
});

function isSafeWorkspaceRoot(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return false;
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) return false;

  const disallowed = [
    '/bin', '/sbin', '/usr', '/etc', '/var', '/lib', '/boot', '/sys', '/proc', '/dev',
    'c:\\windows', 'c:\\program files', 'c:\\program files (x86)', 'c:\\programdata'
  ];
  const lower = resolved.toLowerCase();
  for (const d of disallowed) {
    if (lower === d || lower.startsWith(d + path.sep)) {
      return false;
    }
  }

  const safeParents = [];
  try { safeParents.push(getDefaultWorkspaceRoot()); } catch {}
  try { safeParents.push(app.getPath('documents')); } catch {}
  try { safeParents.push(app.getPath('videos')); } catch {}
  try { safeParents.push(app.getPath('desktop')); } catch {}
  try { safeParents.push(app.getPath('home')); } catch {}

  for (const parent of safeParents) {
    if (!parent) continue;
    const resParent = path.resolve(parent);
    const prefix = resParent.endsWith(path.sep) ? resParent : resParent + path.sep;
    if (resolved.startsWith(prefix) && resolved !== resParent) {
      return true;
    }
  }
  return false;
}

ipcMain.handle('register-workspace-root', async (event, dirPath) => {
  try {
    if (!dirPath || typeof dirPath !== 'string') {
      throw new Error('Invalid workspace path');
    }
    const resolvedRoot = path.resolve(dirPath);
    if (!isSafeWorkspaceRoot(resolvedRoot)) {
      throw new Error(`Unauthorized workspace root path: ${resolvedRoot}`);
    }
    await fs.promises.mkdir(resolvedRoot, { recursive: true });
    await fs.promises.mkdir(path.join(resolvedRoot, 'Projects'), { recursive: true });
    await fs.promises.mkdir(path.join(resolvedRoot, 'Videos'), { recursive: true });
    await fs.promises.mkdir(path.join(resolvedRoot, 'Audio'), { recursive: true });
    await fs.promises.mkdir(path.join(resolvedRoot, 'Assets'), { recursive: true });

    allowedPaths.add(resolvedRoot);
    console.log(`[ELECTRON] Registered workspace root: ${resolvedRoot}`);
    return { success: true, rootPath: resolvedRoot };
  } catch (error) {
    console.error('[ELECTRON] register-workspace-root failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('write-file-direct', async (event, { filePath, data }) => {
  try {
    if (!isPathAllowed(filePath)) {
      throw new Error(`Unauthorized path access: ${filePath}`);
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, Buffer.from(data));
    return { success: true, filePath };
  } catch (error) {
    console.error('[ELECTRON] write-file-direct failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('path-exists', async (event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string' || !isPathAllowed(filePath)) {
      return false;
    }
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string' || !isPathAllowed(filePath)) {
      throw new Error(`Unauthorized path access: ${filePath}`);
    }
    const { shell } = require('electron');
    shell.showItemInFolder(filePath);
    return { success: true };
  } catch (error) {
    console.error('[ELECTRON] show-item-in-folder failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-file', async (_event, { filePath } = {}) => {
  try {
    if (!filePath || typeof filePath !== 'string' || !isPathAllowed(filePath)) {
      throw new Error(`Unauthorized or invalid path access: ${filePath}`);
    }
    await fs.promises.unlink(filePath);
    return { success: true };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { success: true, alreadyDeleted: true };
    }
    console.error('[ELECTRON] delete-file failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('set-progress-bar', async (event, progress) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(progress);
    }
    return { success: true };
  } catch (error) {
    console.error('[ELECTRON] set-progress-bar failed:', error);
    return { success: false, error: error.message };
  }
});

function resolveLocalFfmpegPath() {
  const exeName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const platformDir = process.platform === 'win32' ? 'ffmpeg-win' : process.platform === 'darwin' ? 'ffmpeg-mac' : 'ffmpeg-linux';
  const resPath = process.resourcesPath || '';
  const candidates = [
    resPath ? path.join(resPath, exeName) : '',
    resPath ? path.join(resPath, platformDir, exeName) : '',
    resPath ? path.join(resPath, 'bin', exeName) : '',
    path.join(__dirname, '..', 'resources', exeName),
    path.join(__dirname, '..', 'resources', platformDir, exeName),
    path.join(process.cwd(), 'resources', exeName),
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    const ffmpegStatic = require('ffmpeg-static');
    if (typeof ffmpegStatic === 'string' && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  } catch (e) {}
  return 'ffmpeg';
}

ipcMain.handle('ffmpeg-concat-segments', async (event, { segmentPaths, outputPath } = {}) => {
  try {
    if (!segmentPaths || !Array.isArray(segmentPaths) || segmentPaths.length === 0) {
      throw new Error('segmentPaths must be a non-empty array of file paths.');
    }
    if (!outputPath || typeof outputPath !== 'string') {
      throw new Error('outputPath required for concatenation.');
    }

    const ffmpegExe = resolveLocalFfmpegPath();
    const tempDir = app.getPath('temp') || os.tmpdir();
    const manifestPath = path.join(tempDir, `cg_concat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.txt`);
    
    // Build concat demuxer manifest
    const lines = segmentPaths.map(p => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join('\n');
    await fs.promises.writeFile(manifestPath, lines, 'utf8');

    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

    return new Promise((resolve) => {
      const args = [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', manifestPath,
        '-c', 'copy',
        '-movflags', '+faststart',
        outputPath
      ];

      console.log(`[ELECTRON CONCAT] Executing FFmpeg: ${ffmpegExe} with ${segmentPaths.length} segments -> ${outputPath}`);
      const proc = spawn(ffmpegExe, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';

      proc.stderr.on('data', d => {
        stderr = (stderr + d.toString()).slice(-4000);
      });

      proc.on('error', async (err) => {
        try { await fs.promises.unlink(manifestPath); } catch {}
        console.error('[ELECTRON CONCAT] FFmpeg spawn error:', err);
        resolve({ success: false, error: `FFmpeg spawn error: ${err.message}` });
      });

      proc.on('exit', async (code) => {
        try { await fs.promises.unlink(manifestPath); } catch {}
        if (code === 0) {
          try {
            const stat = await fs.promises.stat(outputPath);
            allowedPaths.add(path.dirname(outputPath));
            allowedPaths.add(outputPath);
            resolve({ success: true, filePath: outputPath, size: stat.size });
          } catch (stErr) {
            allowedPaths.add(outputPath);
            resolve({ success: true, filePath: outputPath });
          }
        } else {
          console.error(`[ELECTRON CONCAT] FFmpeg exited with code ${code}:`, stderr);
          resolve({ success: false, error: `FFmpeg concat exited with code ${code}. ${stderr.slice(-500)}` });
        }
      });
    });
  } catch (error) {
    console.error('[ELECTRON CONCAT] Error:', error);
    return { success: false, error: error.message };
  }
});

// Dedicated Hidden Export Worker Lifecycle
ipcMain.handle('create-export-worker', async () => {
  try {
    if (exportWorkerWindow && !exportWorkerWindow.isDestroyed()) {
      try { exportWorkerWindow.destroy(); } catch {}
    }

    exportWorkerWindow = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false, // Fully hidden background window
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        preload: path.join(__dirname, 'preload.cjs'),
        backgroundThrottling: false, // Never throttle background export rendering
      }
    });

    exportWorkerWindow.webContents.on('render-process-gone', (event, details) => {
      console.error('[ELECTRON EXPORT WORKER] Worker process gone:', details);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('export-worker-crashed', {
          reason: details.reason,
          exitCode: details.exitCode
        });
      }
      exportWorkerWindow = null;
    });

    const url = `http://127.0.0.1:${globalPort}?exportWorker=1`;
    await exportWorkerWindow.loadURL(url);
    console.log('[ELECTRON] Spawned dedicated background export worker at:', url);
    return { success: true };
  } catch (err) {
    console.error('[ELECTRON] Failed to create export worker:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('destroy-export-worker', async () => {
  try {
    if (exportWorkerWindow && !exportWorkerWindow.isDestroyed()) {
      exportWorkerWindow.destroy();
    }
    exportWorkerWindow = null;
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('send-to-export-worker', async (event, payload) => {
  try {
    if (!exportWorkerWindow || exportWorkerWindow.isDestroyed()) {
      throw new Error('Export worker window is not active.');
    }
    exportWorkerWindow.webContents.send('export-worker-job', payload);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('export-worker-relay-event', async (event, payload) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('export-worker-event', payload);
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

function getCanonicalPath(targetPath) {
    try {
        if (fs.existsSync(targetPath)) {
            return fs.realpathSync(targetPath);
        }
        const parent = path.dirname(targetPath);
        if (fs.existsSync(parent)) {
            return path.join(fs.realpathSync(parent), path.basename(targetPath));
        }
    } catch (e) {}
    return path.resolve(targetPath);
}

function isPathAllowed(filePath) {
    if (!filePath || typeof filePath !== 'string') return false;
    const resolvedFile = path.resolve(filePath);
    const canonicalFile = getCanonicalPath(filePath);

    // Auto-check against default workspace root
    try {
        const root = path.resolve(getDefaultWorkspaceRoot());
        const canonicalRoot = getCanonicalPath(root);
        const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
        const canonicalRootPrefix = canonicalRoot.endsWith(path.sep) ? canonicalRoot : canonicalRoot + path.sep;
        if (
            resolvedFile === root || resolvedFile.startsWith(rootPrefix) ||
            canonicalFile === canonicalRoot || canonicalFile.startsWith(canonicalRootPrefix)
        ) {
            allowedPaths.add(root);
            return true;
        }
    } catch (e) {}

    for (const allowed of allowedPaths) {
        const resolvedAllowed = path.resolve(allowed);
        const canonicalAllowed = getCanonicalPath(allowed);
        const prefix = resolvedAllowed.endsWith(path.sep) ? resolvedAllowed : resolvedAllowed + path.sep;
        const canonicalPrefix = canonicalAllowed.endsWith(path.sep) ? canonicalAllowed : canonicalAllowed + path.sep;

        if (
            resolvedFile === resolvedAllowed ||
            resolvedFile.startsWith(prefix) ||
            canonicalFile === canonicalAllowed ||
            canonicalFile.startsWith(canonicalPrefix)
        ) {
            return true;
        }
    }

    return false;
}

const openFileHandles = new Map(); // fd -> FileHandle

ipcMain.handle('fs-open', async (_event, filePath, flags) => {
    try {
        if (!isPathAllowed(filePath)) {
            throw new Error(`Unauthorized path access: ${filePath}`);
        }

        const handle = await fs.promises.open(filePath, flags);
        openFileHandles.set(handle.fd, handle);
        return handle.fd;
    } catch (error) {
        console.error('[ELECTRON FS] fs-open failed:', {
            filePath,
            flags,
            error: error.message,
            stack: error.stack
        });

        throw error;
    }
});

ipcMain.handle('fs-write', async (_event, fd, data, position) => {
    try {
        if (!data || (!(data instanceof Uint8Array) && !Buffer.isBuffer(data))) {
            throw new Error('fs-write expected Uint8Array or Buffer');
        }
        const handle = openFileHandles.get(fd);
        if (!handle) {
            throw new Error(`fs-write: no open file handle for fd ${fd}`);
        }

        const buffer = Buffer.isBuffer(data)
            ? data
            : Buffer.from(data.buffer, data.byteOffset, data.byteLength);

        let totalWritten = 0;
        let nextPosition = position == null ? null : Number(position);

        while (totalWritten < buffer.length) {
            const remaining = buffer.length - totalWritten;
            const result = await handle.write(
                buffer,
                totalWritten,
                remaining,
                nextPosition
            );

            if (!result || result.bytesWritten <= 0) {
                throw new Error('fs-write made no progress while writing the file.');
            }

            totalWritten += result.bytesWritten;
            if (nextPosition != null) nextPosition += result.bytesWritten;
        }

        return { bytesWritten: totalWritten };
    } catch (error) {
        console.error('[ELECTRON FS] fs-write failed:', {
            fd,
            position,
            dataLength: data?.byteLength,
            error: error.message,
            stack: error.stack
        });

        throw error;
    }
});

ipcMain.handle('fs-close', async (_event, fd) => {
    const handle = openFileHandles.get(fd);
    if (handle) {
        await handle.close();
        openFileHandles.delete(fd);
    }
    return true;
});

ipcMain.handle('fs-stat', async (_event, filePath) => {
    try {
        if (!isPathAllowed(filePath)) {
            throw new Error(`Unauthorized path access: ${filePath}`);
        }

        const stats = await fs.promises.stat(filePath);

        let mediaKind = 'unknown';
        if (stats.isFile() && stats.size >= 12) {
            const header = Buffer.alloc(64);
            const handle = await fs.promises.open(filePath, 'r');
            try {
                await handle.read(header, 0, header.length, 0);
            } finally {
                await handle.close();
            }

            // ISO-BMFF/MP4 normally contains an "ftyp" box in the first 64 bytes.
            if (header.includes(Buffer.from('ftyp'))) {
                mediaKind = 'mp4';
            } else if (header.subarray(0, 4).equals(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]))) {
                mediaKind = 'webm';
            }
        }

        return {
            size: stats.size,
            isFile: stats.isFile(),
            mediaKind
        };
    } catch (error) {
        console.error('[ELECTRON FS] fs-stat failed:', error);
        throw error;
    }
});

app.whenReady().then(async () => {
  try {
    const root = getDefaultWorkspaceRoot();
    ensureWorkspaceStructure(root);
    console.log('[ELECTRON] Initialized default workspace structure at:', root);
  } catch (initWsErr) {
    console.error('[ELECTRON] Failed to initialize default workspace structure at launch:', initWsErr);
  }

  const isDev = !app.isPackaged;
  
  if (!isDev) {
    // In production, find a free port and run the bundled server
    const net = require('net');
    function getPort() {
      return new Promise((resolve) => {
        const preferredPort = 8765;
        const srv = net.createServer();
        
        srv.on('error', () => {
          // If preferred port is taken, fallback to random port
          const randomSrv = net.createServer();
          randomSrv.listen(0, () => {
            const port = randomSrv.address().port;
            randomSrv.close(() => resolve(port));
          });
        });

        srv.listen(preferredPort, '127.0.0.1', () => {
          srv.close(() => resolve(preferredPort));
        });
      });
    }
    
    const port = await getPort();

    // Robust discovery of dist/server.js across packed asar, asar.unpacked, and resources directories
    const unpackedDistServer = path.join(__dirname, '..', 'dist', 'server.js').replace('app.asar', 'app.asar.unpacked');
    const asarDistServer = path.join(__dirname, '..', 'dist', 'server.js');
    const resourcesServer = process.resourcesPath 
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'server.js')
      : null;
    const appPathServer = path.join(app.getAppPath().replace('app.asar', 'app.asar.unpacked'), 'dist', 'server.js');

    const candidatePaths = [
      unpackedDistServer,
      resourcesServer,
      appPathServer,
      asarDistServer,
      path.join(__dirname, '..', 'dist-server', 'server.js').replace('app.asar', 'app.asar.unpacked'),
      path.join(__dirname, '..', 'dist-server', 'server.js')
    ].filter(Boolean);

    let serverPath = candidatePaths.find(p => fs.existsSync(p));

    if (!serverPath) {
      console.error('[ELECTRON] Could not locate backend server.js. Tried candidates:', candidatePaths);
      dialog.showErrorBox(
        'Startup Error',
        `Could not find backend server.js file.\n\nTried paths:\n${candidatePaths.join('\n')}`
      );
      return;
    }

    console.log('[ELECTRON] Located backend server at:', serverPath);

    const userDataPath = app.getPath('userData');
    const tempPath = app.getPath('temp');
    try {
      fs.mkdirSync(userDataPath, { recursive: true });
    } catch (e) {}

    const serverDir = path.dirname(serverPath);
    const nodeModulesDirs = [
      path.join(serverDir, '..', 'node_modules'),
      path.join(serverDir, 'node_modules'),
      process.resourcesPath ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules') : '',
      process.env.NODE_PATH || ''
    ].filter(Boolean).join(path.delimiter);

    // Dynamic memory headroom calculation:
    // Avoid setting an unconditional 8GB ceiling which causes V8 to delay major GC compaction.
    // Default to a balanced 4096 MB (or up to 40% of host RAM on tighter machines, minimum 1536 MB).
    const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));
    const maxOldSpaceMb = process.env.ELECTRON_SERVER_MAX_OLD_SPACE
      ? parseInt(process.env.ELECTRON_SERVER_MAX_OLD_SPACE, 10)
      : Math.min(4096, Math.max(1536, Math.floor(totalMemMb * 0.4)));

    serverProcess = fork(serverPath, [], {
      cwd: userDataPath, // ALWAYS execute server in user's writable AppData, never in read-only C:\Program Files!
      stdio: 'pipe',
      execArgv: [`--max-old-space-size=${maxOldSpaceMb}`, '--max-http-header-size=65536'], // Balanced memory limit and allow large Google cookies
      env: {
        ...process.env,
        PORT: port.toString(),
        NODE_ENV: 'production',
        IS_DESKTOP: 'true',
        ELECTRON: '1',
        ELECTRON_RUN_AS_NODE: '1',
        NODE_PATH: nodeModulesDirs,
        RESOURCES_PATH: process.resourcesPath || '',
        USER_DATA_PATH: userDataPath,
        TEMP_DIR: tempPath,
        GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
        GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '',
        GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || ''
      }
    });

    serverProcess.on('error', (err) => {
      console.error('[ELECTRON] Server process failed to spawn:', err);
      dialog.showErrorBox(
        'Server Launch Error',
        `Failed to spawn local background server.\n\nError: ${err.message}\nPath: ${serverPath}`
      );
    });

    if (serverProcess.stdout) {
      serverProcess.stdout.on('data', d => console.log('SERVER OUT:', d.toString()));
    }
    if (serverProcess.stderr) {
      serverProcess.stderr.on('data', d => {
        const text = d.toString();
        console.error('SERVER ERR:', text);
        lastServerErr = (lastServerErr + text).slice(-3000);
      });
    }
    serverProcess.on('exit', (code, signal) => {
      if (!isQuitting && code !== 0 && code !== null) {
        dialog.showErrorBox(
          'Backend Error',
          `Server exited with code ${code}.\n\nDiagnostics:\n${lastServerErr || 'No error output captured. Check system logs.'}`
        );
      }
    });
    
    createWindow(port);

  } else {
    // In development mode, we rely on the concurrently script to start the server first
    createWindow(3000);
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(globalPort);
    }
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  if (serverProcess) {
    try {
      serverProcess.kill('SIGTERM');
    } catch (e) {}
  }
});

process.on('uncaughtException', (error) => {
  console.error('[MAIN] UNCAUGHT EXCEPTION:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[MAIN] UNHANDLED REJECTION:', reason);
});

app.on('child-process-gone', (_event, details) => {
  console.error('[ELECTRON] CHILD PROCESS GONE:', details);
});
