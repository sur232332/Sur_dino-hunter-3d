const { app, BrowserWindow, protocol } = require('electron');
const path = require('path');
const fs = require('fs');

protocol.registerSchemesAsPrivileged([
    {
        scheme: 'app',
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true
        }
    }
]);

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.glb': 'model/gltf-binary',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.woff2': 'font/woff2'
};

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        title: 'DEER & DINO HUNTER 2026: GTA VI ULTRA EDITION',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true
        }
    });

    mainWindow.loadURL('app://dino-hunter/index.html');
}

app.whenReady().then(() => {
    const publicRoot = path.resolve(__dirname, 'public');

    protocol.handle('app', async (request) => {
        try {
            const u = new URL(request.url);
            let relPath = decodeURIComponent(u.pathname || '/index.html');
            if (relPath === '/' || relPath === '') relPath = '/index.html';
            const absPath = path.resolve(publicRoot, '.' + relPath);
            if (!absPath.startsWith(publicRoot + path.sep) && absPath !== publicRoot) {
                return new Response('Forbidden', { status: 403 });
            }
            const data = await fs.promises.readFile(absPath);
            const ext = path.extname(absPath).toLowerCase();
            return new Response(data, {
                status: 200,
                headers: { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' }
            });
        } catch (err) {
            return new Response('Not Found', { status: 404 });
        }
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
