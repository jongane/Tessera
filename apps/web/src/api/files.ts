import type { CardFileList, FileInfo } from '@tessera/shared'
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { currentConnectionId } from '../live/live-connection'
import { api } from './client'
import { messagesKey } from './query-keys'

// A card's files (docs/api.md, "Files"). The key starts with the card's, so
// the card's live signal and the reload after a reconnect pick it up.
export function cardFilesKey(cardId: string) {
  return ['cards', cardId, 'files'] as const
}

// Newest first.
export function useCardFiles(cardId: string) {
  return useQuery({
    queryKey: cardFilesKey(cardId),
    queryFn: () => api<CardFileList>(`/cards/${cardId}/files`),
  })
}

// Everything about the card that a file changes: its files and its Activity.
export function reloadCard(queryClient: QueryClient, cardId: string) {
  return queryClient.invalidateQueries({ queryKey: ['cards', cardId] })
}

// Removes a file of the card, or of a message in the card's chat. The chat's
// messages reload too, as they show the file.
export function useRemoveFile(cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: FileInfo) =>
      api<void>(`/files/${file.id}`, { method: 'DELETE' }),
    onSuccess: (_, file) => {
      queryClient.setQueryData<CardFileList>(
        cardFilesKey(cardId),
        (list) => list && { files: list.files.filter((f) => f.id !== file.id) },
      )
      if (file.chatId) {
        void queryClient.invalidateQueries({
          queryKey: messagesKey(file.chatId),
        })
      }
      return reloadCard(queryClient, cardId)
    },
  })
}

// Deletes a pending file (one uploaded into a message box and then taken out
// again). Nobody else sees it, so nothing else needs to change.
// Only a pending file of that chat is deleted: a file that was sent meanwhile
// answers 409 and stays.
export function removePendingFile(
  chatId: string,
  fileId: string,
): Promise<void> {
  return api<void>(`/chats/${chatId}/files/${fileId}`, { method: 'DELETE' })
}

const UPLOAD_FAILED = 'Couldn’t upload, try again'

// One upload in progress. Done with XMLHttpRequest, not fetch, because only
// that reports how far an upload has got and can be cancelled.
export interface Upload {
  // Says how far it has got (0 to 100).
  onProgress: (percent: number) => void
  // Ends with the stored file, or with the words to show for the failure.
  onDone: (file: FileInfo) => void
  onFailed: (message: string) => void
  // Called when it is cancelled (Cancel), after which nothing else is said.
  onCancelled: () => void
}

export interface RunningUpload {
  cancel: () => void
}

// Sends `file` to `address` (a card's or a chat's files), under `name`. A 4xx
// answer shows the server's own words; anything else ("couldn't reach the
// server", a 5xx) a general message.
export function uploadFile(
  address: string,
  file: File,
  name: string,
  handlers: Upload,
): RunningUpload {
  const xhr = new XMLHttpRequest()
  xhr.open('POST', `/api${address}`)
  const connectionId = currentConnectionId()
  if (connectionId) {
    xhr.setRequestHeader('X-Live-Connection', connectionId)
  }
  xhr.upload.addEventListener('progress', (event) => {
    if (event.lengthComputable && event.total > 0) {
      handlers.onProgress(Math.round((event.loaded / event.total) * 100))
    }
  })
  xhr.addEventListener('load', () => {
    if (xhr.status === 201) {
      handlers.onDone(JSON.parse(xhr.responseText) as FileInfo)
    } else {
      handlers.onFailed(refusal(xhr))
    }
  })
  xhr.addEventListener('error', () => handlers.onFailed(UPLOAD_FAILED))
  xhr.addEventListener('timeout', () => handlers.onFailed(UPLOAD_FAILED))
  xhr.addEventListener('abort', handlers.onCancelled)
  const form = new FormData()
  form.append('file', file, name)
  xhr.send(form)
  return { cancel: () => xhr.abort() }
}

function refusal(xhr: XMLHttpRequest): string {
  if (xhr.status < 400 || xhr.status >= 500) {
    return UPLOAD_FAILED
  }
  try {
    const body = JSON.parse(xhr.responseText) as { message?: unknown }
    return typeof body.message === 'string' ? body.message : UPLOAD_FAILED
  } catch {
    return UPLOAD_FAILED
  }
}

// A file just stored on the card: shown at once, then reloaded with the card's
// Activity.
export function showStoredOnCard(
  queryClient: QueryClient,
  cardId: string,
  stored: FileInfo,
) {
  queryClient.setQueryData<CardFileList>(
    cardFilesKey(cardId),
    (list) => list && { files: [stored, ...list.files] },
  )
  void reloadCard(queryClient, cardId)
}
