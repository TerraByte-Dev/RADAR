// The preload (spec 8.2): two functions, generated from the route table, exposed as
// `window.radar`. Only names in the table reach main.
import { contextBridge, ipcRenderer } from 'electron'
import { EVENTS, ROUTES, type Bridge } from '../shared/ipc'

const routes = new Set<string>(ROUTES)
const events = new Set<string>(EVENTS)

const bridge: Bridge = {
  invoke: ((name: string, req?: unknown) =>
    routes.has(name)
      ? ipcRenderer.invoke(name, req)
      : Promise.resolve({ ok: false, error: { code: 'E_BAD_REQUEST', message: `${name}: no such route` } })) as Bridge['invoke'],
  on: ((event: string, cb: (payload: unknown) => void) => {
    if (!events.has(event)) return () => {}
    const listener = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  }) as Bridge['on']
}

contextBridge.exposeInMainWorld('radar', bridge)
