const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, exec } = require('child_process');
const http = require('http');

let mainWindow = null;
let engineProcess = null;
let currentWorkspace = path.resolve(__dirname, '..');

const ENGINE_PORT = 8000;
const ENGINE_URL = `http://127.0.0.1:${ENGINE_PORT}`;

// Locate Python Virtualenv or system python
function getPythonPath() {
    const candidates = [
        path.resolve(__dirname, '../../.venv-qwen-systems/bin/python3'),
        path.resolve(__dirname, '../.venv-qwen-systems/bin/python3'),
        path.resolve(__dirname, '../.venv/bin/python3'),
        'python3'
    ];
    for (const p of candidates) {
        if (p === 'python3' || fs.existsSync(p)) {
            return p;
        }
    }
    return 'python3';
}

// Start local Engine Daemon
function ensureEngineDaemon() {
    const checkReq = http.get(`${ENGINE_URL}/health`, (res) => {
        if (res.statusCode === 200) {
            console.log('Apex Studio Engine is already running.');
        }
    });

    checkReq.on('error', () => {
        console.log('Starting bundled Apex Studio Engine Daemon...');
        const pythonBin = getPythonPath();
        const rootDir = path.resolve(__dirname, '..');

        engineProcess = spawn(pythonBin, ['-m', 'engine.server'], {
            cwd: rootDir,
            env: {
                ...process.env,
                APEX_WORKSPACE: currentWorkspace,
                APEX_PORT: String(ENGINE_PORT)
            },
            stdio: 'inherit'
        });

        engineProcess.on('error', (err) => {
            console.error('Failed to spawn Apex Engine:', err);
        });

        engineProcess.on('exit', (code, sig) => {
            console.log(`Apex Engine exited with code ${code}, sig ${sig}`);
            engineProcess = null;
        });
    });
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1080,
        minHeight: 700,
        title: 'Apex Studio',
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 14, y: 14 },
        backgroundColor: '#181818',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    setupMenu();

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function setupMenu() {
    const template = [
        {
            label: app.name,
            submenu: [
                { role: 'about', label: 'About Apex Studio' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide', label: 'Hide Apex Studio' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit', label: 'Quit Apex Studio' }
            ]
        },
        {
            label: 'File',
            submenu: [
                {
                    label: 'Open Workspace Folder...',
                    accelerator: 'CmdOrCtrl+O',
                    click: async () => {
                        const res = await dialog.showOpenDialog(mainWindow, {
                            properties: ['openDirectory']
                        });
                        if (!res.canceled && res.filePaths.length > 0) {
                            currentWorkspace = res.filePaths[0];
                            mainWindow.webContents.send('menu:action', {
                                type: 'workspaceOpened',
                                path: currentWorkspace
                            });
                        }
                    }
                },
                { type: 'separator' },
                {
                    label: 'Save File',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => mainWindow.webContents.send('menu:action', { type: 'saveFile' })
                },
                {
                    label: 'New File',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => mainWindow.webContents.send('menu:action', { type: 'newFile' })
                },
                { type: 'separator' },
                { role: 'close', label: 'Close Window' }
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
                { role: 'paste' },
                { role: 'selectAll' }
            ]
        },
        {
            label: 'AI Studio',
            submenu: [
                {
                    label: 'Plan Feature (ApexPhi-Think)...',
                    accelerator: 'CmdOrCtrl+P',
                    click: () => mainWindow.webContents.send('menu:action', { type: 'focusPlan' })
                },
                {
                    label: 'Execute Step / All (ApexPhi-Coder)...',
                    accelerator: 'CmdOrCtrl+Shift+E',
                    click: () => mainWindow.webContents.send('menu:action', { type: 'executeAll' })
                },
                { type: 'separator' },
                {
                    label: 'Switch to Phi Suite (14B)',
                    click: () => mainWindow.webContents.send('menu:action', { type: 'switchSuite', suite: 'phi' })
                },
                {
                    label: 'Switch to Mistral Suite (22B)',
                    click: () => mainWindow.webContents.send('menu:action', { type: 'switchSuite', suite: 'mistral' })
                },
                {
                    label: 'Switch to Qwen Suite (14B)',
                    click: () => mainWindow.webContents.send('menu:action', { type: 'switchSuite', suite: 'qwen' })
                }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'forceReload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'Apex Studio Documentation',
                    click: () => shell.openExternal('https://github.com/nileshchakraborty/apex-studio')
                },
                {
                    label: 'Report Issue',
                    click: () => shell.openExternal('https://github.com/nileshchakraborty/apex-studio/issues')
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
}

// IPC Handlers
ipcMain.handle('dialog:openFolder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (!res.canceled && res.filePaths.length > 0) {
        currentWorkspace = res.filePaths[0];
        return currentWorkspace;
    }
    return null;
});

ipcMain.handle('workspace:getPath', () => currentWorkspace);

function readDirectoryRecursive(dirPath, depth = 0, maxDepth = 3) {
    if (depth > maxDepth) return [];
    const entries = [];
    try {
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const f of files) {
            if (f.name.startsWith('.') || f.name === 'node_modules' || f.name === '__pycache__' || f.name === '.git') {
                continue;
            }
            const fullPath = path.join(dirPath, f.name);
            if (f.isDirectory()) {
                entries.push({
                    name: f.name,
                    path: fullPath,
                    isDirectory: true,
                    children: readDirectoryRecursive(fullPath, depth + 1, maxDepth)
                });
            } else {
                entries.push({
                    name: f.name,
                    path: fullPath,
                    isDirectory: false
                });
            }
        }
    } catch (e) {
        console.error('Error reading dir:', e);
    }
    return entries;
}

ipcMain.handle('fs:readDir', async (_event, dirPath) => {
    const target = dirPath || currentWorkspace;
    return readDirectoryRecursive(target, 0, 3);
});

ipcMain.handle('fs:readFile', async (_event, filePath) => {
    try {
        return fs.readFileSync(filePath, 'utf8');
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('fs:writeFile', async (_event, filePath, content) => {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content, 'utf8');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('fs:createFile', async (_event, filePath) => {
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, '', 'utf8');
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('fs:createFolder', async (_event, folderPath) => {
    try {
        fs.mkdirSync(folderPath, { recursive: true });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('fs:deletePath', async (_event, targetPath) => {
    try {
        if (fs.existsSync(targetPath)) {
            const stat = fs.statSync(targetPath);
            if (stat.isDirectory()) {
                fs.rmSync(targetPath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(targetPath);
            }
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('shell:runCommand', async (_event, cmd, cwd) => {
    return new Promise((resolve) => {
        exec(cmd, { cwd: cwd || currentWorkspace, timeout: 60000 }, (error, stdout, stderr) => {
            resolve({
                code: error ? error.code || 1 : 0,
                stdout: stdout || '',
                stderr: stderr || '',
                error: error ? error.message : null
            });
        });
    });
});

ipcMain.handle('engine:getStatus', async () => {
    return new Promise((resolve) => {
        http.get(`${ENGINE_URL}/api/status`, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve({ status: 'online' }); }
            });
        }).on('error', () => resolve({ status: 'offline' }));
    });
});

ipcMain.handle('engine:restart', () => {
    if (engineProcess) {
        engineProcess.kill();
        engineProcess = null;
    }
    ensureEngineDaemon();
    return { status: 'restarting' };
});

// App Lifecycle
app.whenReady().then(() => {
    ensureEngineDaemon();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('before-quit', () => {
    if (engineProcess) {
        console.log('Terminating engine process...');
        engineProcess.kill();
        engineProcess = null;
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
