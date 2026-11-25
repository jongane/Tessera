import {
  type CardFileList,
  type FileInfo,
  MESSAGE_FILES_MAX,
  MESSAGE_TOO_MANY_FILES_MESSAGE,
  screenshotName,
} from '@tessera/shared'
import { useSyncExternalStore } from 'react'
import { api } from '../api/client'
import { removePendingFile, uploadFile } from '../api/files'
import { tooBigMessage } from '../cards/use-uploads'

// Messages on their way (or that could not be sent) and the text typed into
// each chat's message box but not sent. They belong to one open board, so
// switching chats keeps them while the page is open.

export interface OutgoingMessage {
  // A UUID, also the id the message is saved with.
  id: string
  chatId: string
  body: string
  // When the person sent it.
  createdAt: string
  status: 'sending' | 'failed' | 'saved'
  // Why it failed, as the person is told.
  error?: string
  // The files sent with it (pending files of this chat). Undefined for a
  // message sent with no file box in play.
  files?: FileInfo[]
}

// A file in a chat's message box: being uploaded, uploaded (a pending file on
// the server) or failed.
export interface Attachment {
  id: number
  chatId: string
  // The file picked; null for one found on the server (left from earlier).
  file: File | null
  // The name it is stored under (a pasted screenshot gets its own).
  name: string
  // 0 to 100.
  percent: number
  // Why the upload stopped, once it has failed.
  error: string | null
  // The pending file, once the upload is done.
  stored: FileInfo | null
  // Stops the upload while it runs.
  cancel: () => void
}

// A message that was sent while files were still uploading, and sends itself
// once they have finished. `body` is what was on screen when Send was pressed.
export interface WaitingSend {
  body: string
  // Whether the box had files then (even if all are dismissed since).
  withFiles: boolean
  // The files that were in the box then; only these are sent.
  ids: number[]
}

const NO_ATTACHMENTS: Attachment[] = []
const NO_NOTES: string[] = []

// "image.png", "image.jpeg": what a browser calls an image pasted from the
// clipboard that has no name of its own.
const UNNAMED_IMAGE = /^image\.(png|jpe?g|gif|webp)$/i

const NONE: OutgoingMessage[] = []

// A new UUID, which is also the message's id on the server: sending it again
// never saves it twice. crypto.randomUUID is missing on pages not served
// securely (http).
function newId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export class MessageOutbox {
  private entries = new Map<string, OutgoingMessage[]>()
  private drafts = new Map<string, string>()
  private files = new Map<string, Attachment[]>()
  private noteLists = new Map<string, string[]>()
  private waits = new Map<string, WaitingSend>()
  private leftoversAsked = new Set<string>()
  private restores = new Map<string, string>()
  private nextAttachment = 0
  private listeners = new Set<() => void>()

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

  add(chatId: string, body: string, files?: FileInfo[]): OutgoingMessage {
    const entry: OutgoingMessage = {
      id: newId(),
      chatId,
      body,
      files,
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
    const wasEmpty = this.draft(chatId) === ''
    if (markdown === '') {
      this.drafts.delete(chatId)
    } else {
      this.drafts.set(chatId, markdown)
    }
    // Who shows whether the box is in use hears of it when that changes.
    if (wasEmpty !== (markdown === '')) this.notify()
  }

  // Whether the box has text, files, or a message waiting to send.
  inUse(chatId: string): boolean {
    return (
      this.draft(chatId) !== '' ||
      this.attachments(chatId).length > 0 ||
      this.waits.has(chatId)
    )
  }
  // The files in a chat's message box, in the order they were added.
  attachments(chatId: string): Attachment[] {
    return this.files.get(chatId) ?? NO_ATTACHMENTS
  }

  // Why some files were not attached, until the next try.
  notes(chatId: string): string[] {
    return this.noteLists.get(chatId) ?? NO_NOTES
  }

  waitingSend(chatId: string): WaitingSend | null {
    return this.waits.get(chatId) ?? null
  }

  // Starts uploading each file as soon as it is given. A file over the limit
  // or beyond the tenth is refused, in words. `pasted` files that are unnamed
  // images get a "Screenshot ..." name.
  attach(
    chatId: string,
    files: File[],
    options: { limit?: number; pasted?: boolean; picked?: boolean } = {},
  ) {
    // A waiting message is locked: pasting and dropping add nothing to it.
    // (The chooser's own button is off, so `picked` files only come from
    // a chooser opened before; what is sent is fixed by WaitingSend.ids.)
    if (this.waits.has(chatId) && !options.picked) return
    const notes: string[] = []
    for (const file of files) {
      if (options.limit !== undefined && file.size > options.limit) {
        notes.push(tooBigMessage(file, options.limit))
      } else if (this.attachments(chatId).length >= MESSAGE_FILES_MAX) {
        if (!notes.includes(MESSAGE_TOO_MANY_FILES_MESSAGE)) {
          notes.push(MESSAGE_TOO_MANY_FILES_MESSAGE)
        }
      } else {
        this.start(chatId, file, this.nameOf(chatId, file, options.pasted))
      }
    }
    this.noteLists.set(chatId, notes)
    this.notify()
  }

  private nameOf(chatId: string, file: File, pasted = false): string {
    if (!pasted || !UNNAMED_IMAGE.test(file.name)) return file.name
    const extension = file.name.slice(file.name.lastIndexOf('.') + 1)
    const taken = this.attachments(chatId).map((a) => a.name)
    return screenshotName(new Date(), extension.toLowerCase(), taken)
  }

  // Starts (or restarts, for Try again) the upload of `file` in row `id`.
  private start(chatId: string, file: File, name: string, id?: number) {
    const rowId = id ?? this.nextAttachment++
    const change = (fields: Partial<Attachment>) =>
      this.change(chatId, rowId, fields)
    const running = uploadFile(`/chats/${chatId}/files`, file, name, {
      onProgress: (percent) => change({ percent }),
      onDone: (stored) => change({ stored, percent: 100 }),
      onFailed: (error) => change({ error }),
      onCancelled: () => this.drop(chatId, rowId),
    })
    const row: Attachment = {
      id: rowId,
      chatId,
      file,
      name,
      percent: 0,
      error: null,
      stored: null,
      cancel: running.cancel,
    }
    const rows = this.attachments(chatId)
    this.files.set(
      chatId,
      rows.some((r) => r.id === rowId)
        ? rows.map((r) => (r.id === rowId ? row : r))
        : [...rows, row],
    )
    this.notify()
  }

  private change(chatId: string, id: number, fields: Partial<Attachment>) {
    this.files.set(
      chatId,
      this.attachments(chatId)
        .map((r) => (r.id === id ? { ...r, ...fields } : r))
        // A leftover shown for the file this upload just stored is the same
        // file: one chip, one id.
        .filter(
          (r) =>
            !fields.stored ||
            r.id === id ||
            r.file !== null ||
            r.stored?.id !== fields.stored.id,
        ),
    )
    this.notify()
  }

  private drop(chatId: string, id: number) {
    this.files.set(
      chatId,
      this.attachments(chatId).filter((r) => r.id !== id),
    )
    this.notify()
  }

  retry(row: Attachment) {
    if (!row.file) return
    this.start(row.chatId, row.file, row.name, row.id)
  }

  // A failed file the person gives up on.
  dismiss(row: Attachment) {
    this.drop(row.chatId, row.id)
  }

  // Takes a file out of the box: stops its upload, or deletes the pending
  // file it became.
  takeOut(row: Attachment) {
    if (row.stored) {
      this.drop(row.chatId, row.id)
      // Nobody else sees it, and a file left behind is swept after a day.
      removePendingFile(row.chatId, row.stored.id).catch(() => {})
    } else {
      row.cancel()
    }
  }

  // The files went into a message: the box is empty again, and nothing is
  // deleted.
  // Only the given rows when `ids` is given (a waiting send clears what it sent).
  clearAttachments(chatId: string, ids?: number[]) {
    if (ids === undefined) {
      this.files.delete(chatId)
    } else {
      this.files.set(
        chatId,
        this.attachments(chatId).filter((row) => !ids.includes(row.id)),
      )
    }
    this.noteLists.delete(chatId)
    this.notify()
  }

  // Shows the person's own pending files of the chat that the box does not
  // show yet (left after a reload or a refused send). Asked once per chat,
  // unless `again`.
  async loadLeftovers(
    chatId: string,
    again = false,
    only?: ReadonlySet<string>,
  ) {
    if (this.leftoversAsked.has(chatId) && !again) return
    this.leftoversAsked.add(chatId)
    let found: FileInfo[]
    try {
      found = (await api<CardFileList>(`/chats/${chatId}/files`)).files
    } catch {
      this.leftoversAsked.delete(chatId)
      return
    }
    const rows = this.attachments(chatId)
    const known = new Set(
      rows.flatMap((row) => (row.stored ? [row.stored.id] : [])),
    )
    const fresh = found
      .filter((file) => !known.has(file.id) && (!only || only.has(file.id)))
      .map((stored): Attachment => ({
        id: this.nextAttachment++,
        chatId,
        file: null,
        name: stored.name,
        percent: 100,
        error: null,
        stored,
        cancel: () => {},
      }))
    if (fresh.length === 0) return
    this.files.set(chatId, [...fresh, ...rows])
    this.notify()
  }

  // A message that could not be sent goes back into the box: its text is put
  // in the editor (by the box, which sees `restoreText`) and its files, if
  // they still exist, come back as chips.
  putBack(chatId: string, body: string, fileIds: string[]) {
    this.restores.set(chatId, body)
    this.notify()
    void this.loadLeftovers(chatId, true, new Set(fileIds))
  }

  // The text to put back in the editor, until it has been taken.
  restoreText(chatId: string): string | null {
    return this.restores.get(chatId) ?? null
  }

  takeRestore(chatId: string) {
    this.restores.delete(chatId)
  }

  startWaiting(chatId: string, wait: WaitingSend) {
    this.waits.set(chatId, wait)
    this.notify()
  }

  stopWaiting(chatId: string) {
    if (this.waits.delete(chatId)) this.notify()
  }
}

export function useOutgoing(
  outbox: MessageOutbox,
  chatId: string,
): OutgoingMessage[] {
  return useSyncExternalStore(outbox.subscribe, () => outbox.outgoing(chatId))
}

export function useAttachments(
  outbox: MessageOutbox,
  chatId: string,
): Attachment[] {
  return useSyncExternalStore(outbox.subscribe, () =>
    outbox.attachments(chatId),
  )
}

export function useAttachNotes(
  outbox: MessageOutbox,
  chatId: string,
): string[] {
  return useSyncExternalStore(outbox.subscribe, () => outbox.notes(chatId))
}

export function useWaitingSend(
  outbox: MessageOutbox,
  chatId: string,
): WaitingSend | null {
  return useSyncExternalStore(outbox.subscribe, () =>
    outbox.waitingSend(chatId),
  )
}

export function useRestoreText(
  outbox: MessageOutbox,
  chatId: string,
): string | null {
  return useSyncExternalStore(outbox.subscribe, () =>
    outbox.restoreText(chatId),
  )
}

export function useBoxInUse(outbox: MessageOutbox, chatId: string): boolean {
  return useSyncExternalStore(outbox.subscribe, () => outbox.inUse(chatId))
}
