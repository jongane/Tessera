import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useServerSettings } from '../api/auth'
import { uploadFile } from '../api/files'

const MB = 1024 * 1024

export interface UploadRow {
  id: number
  file: File
  // 0 to 100.
  percent: number
  // Why it stopped, once it has failed.
  error: string | null
  cancel: () => void
}

// The files being sent to one card, and the ones that failed. Each file is
// its own upload. A row goes away when its upload has finished (the file is
// then in the card's list), is cancelled, or is dismissed.
export function useUploads(cardId: string) {
  const queryClient = useQueryClient()
  const limit = useServerSettings().data?.fileSizeLimitBytes
  const [rows, setRows] = useState<UploadRow[]>([])
  // The files refused for being too big, in words.
  const [tooBig, setTooBig] = useState<string[]>([])
  const nextId = useRef(0)

  function change(id: number, fields: Partial<UploadRow>) {
    setRows((all) =>
      all.map((row) => (row.id === id ? { ...row, ...fields } : row)),
    )
  }

  function drop(id: number) {
    setRows((all) => all.filter((row) => row.id !== id))
  }

  // Starts (or restarts, for Try again) the upload of `file` in row `id`.
  function send(file: File, id: number) {
    const running = uploadFile(queryClient, cardId, file, {
      onProgress: (percent) => change(id, { percent }),
      onDone: () => drop(id),
      onFailed: (error) => change(id, { error }),
      onCancelled: () => drop(id),
    })
    const row = { id, file, percent: 0, error: null, cancel: running.cancel }
    setRows((all) =>
      all.some((existing) => existing.id === id)
        ? all.map((existing) => (existing.id === id ? row : existing))
        : [row, ...all],
    )
  }

  function attach(files: File[]) {
    const tooLarge = files.filter((f) => limit !== undefined && f.size > limit)
    setTooBig(
      tooLarge.map(
        (f) => `${f.name} is bigger than ${Math.floor(limit! / MB)} MB`,
      ),
    )
    for (const file of files) {
      if (!tooLarge.includes(file)) send(file, nextId.current++)
    }
  }

  return {
    rows,
    tooBig,
    attach,
    retry: (row: UploadRow) => send(row.file, row.id),
    dismiss: drop,
  }
}

export type Uploads = ReturnType<typeof useUploads>
