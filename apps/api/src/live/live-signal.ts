// What the server tells a browser over the live connection: only that
// something changed, never text or names (docs/api.md, "Live updates").
// The browser reloads the data itself, through the normal checks.
export type LiveSignalType = 'card' | 'board' | 'chats' | 'message';

export interface LiveSignal {
  type: LiveSignalType;
  boardId: string;
  cardId?: string;
  chatId?: string;
  messageId?: string;
  // The connection that made the save, so that tab can ignore its own signal.
  by: string | null;
}

export function cardSignal(
  boardId: string,
  cardId: string,
  by: string | null,
): LiveSignal {
  return { type: 'card', boardId, cardId, by };
}

export function boardSignal(boardId: string, by: string | null): LiveSignal {
  return { type: 'board', boardId, by };
}

export function chatsSignal(boardId: string, by: string | null): LiveSignal {
  return { type: 'chats', boardId, by };
}

export function messageSignal(
  boardId: string,
  chatId: string,
  messageId: string,
  by: string | null,
): LiveSignal {
  return { type: 'message', boardId, chatId, messageId, by };
}

// The connection id a browser sends with a save (header X-Live-Connection),
// or null when it sent none.
export function connectionIdFrom(header: string | undefined): string | null {
  const id = header?.trim();
  return id ? id : null;
}

export function boardRoom(boardId: string): string {
  return `board:${boardId}`;
}
