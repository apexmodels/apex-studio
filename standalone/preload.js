const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apexApi', {
    // Workspace & File System
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', dirPath),
    readFile: (filePath) => ipcRenderer.invoke('fs:readFile', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', filePath, content),
    createFile: (filePath) => ipcRenderer.invoke('fs:createFile', filePath),
    createFolder: (folderPath) => ipcRenderer.invoke('fs:createFolder', folderPath),
    deletePath: (targetPath) => ipcRenderer.invoke('fs:deletePath', targetPath),
    getWorkspacePath: () => ipcRenderer.invoke('workspace:getPath'),

    // Terminal / Command Runner
    runCommand: (cmd, cwd) => ipcRenderer.invoke('shell:runCommand', cmd, cwd),

    // Engine Daemon Status & Management
    getEngineStatus: () => ipcRenderer.invoke('engine:getStatus'),
    restartEngine: () => ipcRenderer.invoke('engine:restart'),

    // Event Listeners from Main Menu
    onMenuAction: (callback) => {
        ipcRenderer.on('menu:action', (_event, action) => callback(action));
    }
});
