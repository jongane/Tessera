import type { LayoutStorage } from 'react-resizable-panels'

// Where the chat panel is docked, and how big it is, remembered in this
// browser for now. It must move to the person's account later
// (docs/web-app.md, section 3).

export type Dock = 'right' | 'left' | 'bottom'

const DOCK_KEY = 'tessera.chatPanel.dock'

export function savedDock(): Dock {
  try {
    const value = localStorage.getItem(DOCK_KEY)
    return value === 'left' || value === 'bottom' ? value : 'right'
  } catch {
    return 'right'
  }
}

export function saveDock(dock: Dock) {
  try {
    localStorage.setItem(DOCK_KEY, dock)
  } catch {
    // Storage blocked: the panel goes back to the right next time.
  }
}

// The panel sizes, kept the same way. Reading or writing never fails.
export const panelSizeStorage: LayoutStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key, value) {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Storage blocked: sizes are not remembered.
    }
  },
}
