import type { CardFile } from '@tessera/shared'
import { http, HttpResponse } from 'msw'
import { vi } from 'vitest'
import { ana, apiError, server } from './server'

// A fake API for a card's files (docs/api.md, "Files"), for the Files
// section's tests, and a fake XMLHttpRequest for uploads. The app sends an
// upload with XMLHttpRequest (not fetch), because only that reports how far
// an upload has got and can be cancelled (plan "Web", api/files.ts). Each
// upload the app starts is a FakeXhr the test can answer, move along or
// fail. Every other request goes through MSW as usual.

let nextFile = 1

// A file as the API lists it. A PDF uploaded by Ana, a moment before the
// tests' fixed clock, unless the fields say otherwise.
export function cardFile(
  name: string,
  fields: Partial<CardFile> = {},
): CardFile {
  return {
    id: `ffffffff-ffff-4fff-8fff-${String(nextFile++).padStart(12, '0')}`,
    name,
    size: 12,
    isImage: false,
    uploader: { id: ana.id, displayName: ana.displayName },
    createdAt: '2026-11-07T07:00:00.000Z',
    messageId: null,
    chatId: null,
    ...fields,
  }
}

// What a person's computer hands the app: a File with the size a test wants,
// without really holding that many bytes.
export function pickedFile(name: string, size = 12, type = 'application/pdf') {
  const file = new File([new Uint8Array(Math.min(size, 16))], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

type Listener = (event: Event) => void

class Target extends EventTarget {
  onprogress: Listener | null = null
  onload: Listener | null = null
  onerror: Listener | null = null
  onabort: Listener | null = null
  ontimeout: Listener | null = null
  onloadend: Listener | null = null
  onloadstart: Listener | null = null
  fire(type: string, init: ProgressEventInit = {}) {
    const event = new ProgressEvent(type, init)
    const handler = (this as unknown as Record<string, Listener | null>)[
      `on${type}`
    ]
    handler?.call(this, event)
    this.dispatchEvent(event)
  }
}

// One upload the app has started.
export class FakeXhr extends Target {
  static all: FakeXhr[] = []
  upload = new Target()
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: Document | XMLHttpRequestBodyInit | null = null
  aborted = false
  status = 0
  statusText = ''
  readyState = 0
  responseText = ''
  response: unknown = null
  responseType: XMLHttpRequestResponseType = ''
  withCredentials = false
  timeout = 0
  onreadystatechange: Listener | null = null

  constructor() {
    super()
    FakeXhr.all.push(this)
  }

  open(method: string, url: string | URL) {
    this.method = method
    this.url = String(url)
    this.readyState = 1
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value
  }

  getResponseHeader() {
    return null
  }

  overrideMimeType() {}

  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.body = body ?? null
    this.upload.fire('loadstart')
  }

  abort() {
    if (this.readyState === 4) return
    this.aborted = true
    this.readyState = 0
    this.upload.fire('abort')
    this.fire('abort')
    this.fire('loadend')
  }

  // The name of the file being sent, from the form (field "file").
  get fileName(): string | undefined {
    const file = (this.body as FormData | null)?.get?.('file')
    return file instanceof File ? file.name : undefined
  }

  // Test controls ----------------------------------------------------

  // `fraction` of the file has gone (0 to 1).
  progress(fraction: number, total = 1000) {
    this.upload.fire('progress', {
      lengthComputable: true,
      loaded: Math.round(fraction * total),
      total,
    })
  }

  // The server answered.
  respond(status: number, json: unknown) {
    this.status = status
    this.statusText = String(status)
    this.responseText = JSON.stringify(json)
    this.response = this.responseType === 'json' ? json : this.responseText
    this.readyState = 4
    this.upload.fire('load')
    this.onreadystatechange?.(new Event('readystatechange'))
    this.fire('load')
    this.fire('loadend')
  }

  // The network failed: no answer at all.
  networkError() {
    this.readyState = 4
    this.upload.fire('error')
    this.fire('error')
    this.fire('loadend')
  }
}

// Every upload started so far, in order, and the one named `name`.
export function uploads() {
  return FakeXhr.all
}

export function uploadOf(name: string): FakeXhr {
  const found = FakeXhr.all.filter((x) => x.fileName === name).at(-1)
  if (!found) throw new Error(`No upload of ${name} was started`)
  return found
}

export function installFakeUploads() {
  FakeXhr.all = []
  vi.stubGlobal('XMLHttpRequest', FakeXhr)
}

export interface FakeFilesOptions {
  // The server's limit in bytes (GET /api/server/settings).
  limit?: number
  // What removing a file answers instead of 204.
  removeFails?: { status: number; message: string }
  // How long the list takes (null: never answers).
  listFails?: boolean
}

// Answers a card's file list from `start` (newest first), removes files when
// asked, and adds a file to the list when a fake upload is answered with 201.
// `requests` lists every request to the file endpoints as "METHOD /path".
export function fakeFiles(
  cardId: string,
  start: CardFile[],
  options: FakeFilesOptions = {},
) {
  const state = { files: [...start], failList: options.listFails ?? false }
  const requests: string[] = []
  server.use(
    http.get('/api/server/settings', () =>
      HttpResponse.json({
        signUpOpen: true,
        fileSizeLimitBytes: options.limit ?? 100 * 1024 * 1024,
      }),
    ),
    http.get(`/api/cards/${cardId}/files`, ({ request }) => {
      requests.push(`GET ${new URL(request.url).pathname}`)
      if (state.failList) return apiError(500, 'Broken')
      return HttpResponse.json({ files: state.files })
    }),
    http.delete('/api/files/:fileId', ({ request, params }) => {
      requests.push(`DELETE ${new URL(request.url).pathname}`)
      if (options.removeFails) {
        return apiError(options.removeFails.status, options.removeFails.message)
      }
      state.files = state.files.filter((f) => f.id !== params.fileId)
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return {
    state,
    requests,
    // Someone else attached or removed files on the server.
    serverNowHas(files: CardFile[]) {
      state.files = [...files]
    },
    // The upload `xhr` finished with the stored file: the list has it too.
    stored(file: CardFile, xhr: FakeXhr) {
      state.files = [file, ...state.files]
      xhr.respond(201, file)
    },
  }
}
