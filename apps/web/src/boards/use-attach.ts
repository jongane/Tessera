import { useServerSettings } from '../api/auth'
import type { MessageOutbox } from './message-outbox'

// Puts files into a chat's message box (picked, dropped or pasted): they start
// uploading at once. Needs the server's size limit, so a file that is too big
// is refused before anything is sent.
export function useAttach(outbox: MessageOutbox, chatId: string) {
  const limit = useServerSettings().data?.fileSizeLimitBytes
  return (files: File[], options: { pasted?: boolean } = {}) =>
    outbox.attach(chatId, files, { limit, pasted: options.pasted })
}
