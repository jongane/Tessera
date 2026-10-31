// The cache keys of a board's data, and how often it reloads. The chats' key starts with the board's,
// so reloading the board reloads its chats too.

export function boardKey(boardId: string) {
  return ['boards', boardId] as const
}

export function chatsKey(boardId: string) {
  return ['boards', boardId, 'chats'] as const
}

// While a board is open, it and its chats reload this often, and when you
// come back to the tab (docs/web-app.md, section 6).
export const BOARD_RELOAD_MS = 30_000
