/** Test-only renderer caller of the production Main authorization IPC. */
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('fixtureNative', {
  state: () => ipcRenderer.invoke('dsh-native-authorization:state'),
  start: (choice, bounds) => ipcRenderer.invoke('dsh-native-authorization:start', choice, bounds),
  poll: id => ipcRenderer.invoke('dsh-native-authorization:poll', id),
})
