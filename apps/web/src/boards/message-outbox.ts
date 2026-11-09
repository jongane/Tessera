import { useSyncExternalStore } from 'react'

// Messages on their way (or that could not be sent) and the text typed into
// each chat's message box but not sent. They belong to one open board, so
// switching chats keeps them while the page is open.

export interface OutgoingMessage {
  id: string
  chatId: string
  body: string
  // When the person sent it.
  createdAt: string
  status: 'sending' | 'failed'
  // Why it failed, as the person is told.
  error?: string
}

const NONE: OutgoingMessage[] = []

export class MessageOutbox {
  private entries = new Map<string, OutgoingMessage[]>()
  private drafts = new Map<string, string>()
  private listeners = new Set<() => void>()
  private nextId = 1

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    this.listeners.forEach((listener) => listener())
  }

  outgoing(chatId: string): OutgoingMessage[] {
    return this.entries.get(chatId) ?? NONE
  }

  add(chatId: string, body: string): OutgoingMessage {
    const entry: OutgoingMessage = {
      id: `outgoing-${this.nextId++}`,
      chatId,
      body,
      createdAt: new Date().toISOString(),
      status: 'sending',
    }
    this.entries.set(chatId, [...this.outgoing(chatId), entry])
    this.notify()
    return entry
  }

  update(entry: OutgoingMessage, changes: Partial<OutgoingMessage>) {
    this.entries.set(
      entry.chatId,
      this.outgoing(entry.chatId).map((e) =>
        e.id === entry.id ? { ...e, ...changes } : e,
      ),
    )
    this.notify()
  }

  remove(entry: OutgoingMessage) {
    this.entries.set(
      entry.chatId,
      this.outgoing(entry.chatId).filter((e) => e.id !== entry.id),
    )
    this.notify()
  }

  draft(chatId: string): string {
    return this.drafts.get(chatId) ?? ''
  }

  setDraft(chatId: string, markdown: string) {
    if (markdown === '') {
      this.drafts.delete(chatId)
    } else {
      this.drafts.set(chatId, markdown)
    }
  }
}

export function useOutgoing(
  outbox: MessageOutbox,
  chatId: string,
): OutgoingMessage[] {
  return useSyncExternalStore(outbox.subscribe, () => outbox.outgoing(chatId))
}
