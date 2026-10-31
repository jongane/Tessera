// The cache keys of a board's data. The threads' key starts with the board's,
// so reloading the board reloads its threads too.

export function boardKey(boardId: string) {
  return ['boards', boardId] as const
}

export function threadsKey(boardId: string) {
  return ['boards', boardId, 'threads'] as const
}
