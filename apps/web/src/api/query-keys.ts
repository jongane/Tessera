// The cache keys of a board's data. The chats' key starts with the board's,
// so reloading the board reloads its chats too.

export function boardKey(boardId: string) {
  return ['boards', boardId] as const
}

export function chatsKey(boardId: string) {
  return ['boards', boardId, 'chats'] as const
}

// A chat's messages (newest page first, then older ones).
export function messagesKey(chatId: string) {
  return ['chats', chatId, 'messages'] as const
}

// Every change this tab makes to a card or its place on the board. A reload
// the server asks for waits while one is being saved, so it cannot put back
// what the change has already shown; the change reloads when it has settled.
export function boardEditKey(boardId: string) {
  return ['boards', boardId, 'edit'] as const
}
