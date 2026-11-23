const { app, BrowserWindow } = require('electron');
const path = require('path');

let mainWindow; // Այստեղ հայտարարում ենք փոփոխականը

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // Բեռնում ենք մեր խաղի ֆայլը (index.html)
    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});