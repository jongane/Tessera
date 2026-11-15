import type { CardFile, CardFileList } from '@tessera/shared'
import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { currentConnectionId } from '../live/live-connection'
import { api } from './client'

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
function reloadCard(queryClient: QueryClient, cardId: string) {
  return queryClient.invalidateQueries({ queryKey: ['cards', cardId] })
}

export function useRemoveFile(cardId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (fileId: string) =>
      api<void>(`/files/${fileId}`, { method: 'DELETE' }),
    onSuccess: (_, fileId) => {
      queryClient.setQueryData<CardFileList>(
        cardFilesKey(cardId),
        (list) =>
          list && { files: list.files.filter((file) => file.id !== fileId) },
      )
      return reloadCard(queryClient, cardId)
    },
  })
}

const UPLOAD_FAILED = 'Couldn’t upload, try again'

// One upload in progress. Done with XMLHttpRequest, not fetch, because only
// that reports how far an upload has got and can be cancelled.
export interface Upload {
  // Says how far it has got (0 to 100).
  onProgress: (percent: number) => void
  // Ends with the stored file, or with the words to show for the failure.
  onDone: (file: CardFile) => void
  onFailed: (message: string) => void
  // Called when it is cancelled (Cancel), after which nothing else is said.
  onCancelled: () => void
}

export interface RunningUpload {
  cancel: () => void
}

// Sends `file` to the card. A 4xx answer shows the server's own words;
// anything else ("couldn't reach the server", a 5xx) a general message.
export function uploadFile(
  queryClient: QueryClient,
  cardId: string,
  file: File,
  handlers: Upload,
): RunningUpload {
  const xhr = new XMLHttpRequest()
  xhr.open('POST', `/api/cards/${cardId}/files`)
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
      const stored = JSON.parse(xhr.responseText) as CardFile
      // Shown at once, then reloaded with the card's Activity.
      queryClient.setQueryData<CardFileList>(
        cardFilesKey(cardId),
        (list) => list && { files: [stored, ...list.files] },
      )
      void reloadCard(queryClient, cardId)
      handlers.onDone(stored)
    } else {
      handlers.onFailed(refusal(xhr))
    }
  })
  xhr.addEventListener('error', () => handlers.onFailed(UPLOAD_FAILED))
  xhr.addEventListener('timeout', () => handlers.onFailed(UPLOAD_FAILED))
  xhr.addEventListener('abort', handlers.onCancelled)
  const form = new FormData()
  form.append('file', file)
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
