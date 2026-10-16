const { contextBridge, ipcRenderer } = require('electron');

const invokeWrapper = (channel, ...data) => {
  const validChannels = [
    'show-open-dialog', 'show-save-dialog', 'save-file', 'open-file', 
    'show-notification', 'path-join', 'fs-open', 'fs-write', 'fs-close',
    'fs-stat', 'power-save-blocker-start', 'power-save-blocker-stop',
    'get-known-folder', 'register-workspace-root', 'write-file-direct',
    'path-exists', 'show-item-in-folder', 'set-progress-bar', 'delete-file',
    'ffmpeg-concat-segments', 'create-export-worker', 'destroy-export-worker', 'send-to-export-worker',
    'export-worker-relay-event'
  ];
  if (validChannels.includes(channel)) {
    return ipcRenderer.invoke(channel, ...data);
  }
  return Promise.reject(new Error(`Invalid IPC channel: ${channel}`));
};

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: invokeWrapper,
  ipcRenderer: {
    invoke: invokeWrapper
  },
  on: (channel, listener) => {
    const validEvents = ['export-worker-event', 'export-worker-crashed', 'export-worker-job', 'export-worker-ready'];
    if (validEvents.includes(channel)) {
      const wrapped = (event, ...args) => listener(...args);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    }
  }
});
