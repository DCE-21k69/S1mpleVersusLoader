const { contextBridge, ipcRenderer } = require("electron");

const IPC_CHANNELS = {
  detectPaths: "paths:detect",
  scanAddons: "addons:scan",
  classifyVScript: "addons:classifyVScript",
  getActiveSet: "activeSet:get",
  applyActiveSet: "activeSet:apply",
  addAddon: "activeSet:add",
  removeAddon: "activeSet:remove",
  restoreVanilla: "activeSet:restoreVanilla",
  isGameRunning: "game:isRunning",
  checkForUpdates: "app:checkForUpdates",
  openExternalUrl: "app:openExternalUrl",
  getResumeState: "activeSet:resumeState",
  mergeProgress: "merge:onProgress",
};

const api = {
  detectPaths: () => ipcRenderer.invoke(IPC_CHANNELS.detectPaths),
  scanAddons: () => ipcRenderer.invoke(IPC_CHANNELS.scanAddons),
  classifyVScript: (addons) => ipcRenderer.invoke(IPC_CHANNELS.classifyVScript, addons),
  getActiveSet: () => ipcRenderer.invoke(IPC_CHANNELS.getActiveSet),
  applyActiveSet: (entries) => ipcRenderer.invoke(IPC_CHANNELS.applyActiveSet, entries),
  addAddon: (addonId, priorityOrder) => ipcRenderer.invoke(IPC_CHANNELS.addAddon, addonId, priorityOrder),
  removeAddon: (addonId) => ipcRenderer.invoke(IPC_CHANNELS.removeAddon, addonId),
  restoreVanilla: () => ipcRenderer.invoke(IPC_CHANNELS.restoreVanilla),
  isGameRunning: () => ipcRenderer.invoke(IPC_CHANNELS.isGameRunning),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  openExternalUrl: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternalUrl, url),
  getResumeState: () => ipcRenderer.invoke(IPC_CHANNELS.getResumeState),
  onProgress: (listener) => {
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(IPC_CHANNELS.mergeProgress, handler);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.mergeProgress, handler);
  },
};

contextBridge.exposeInMainWorld("l4d2Api", api);
