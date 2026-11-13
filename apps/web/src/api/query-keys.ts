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
