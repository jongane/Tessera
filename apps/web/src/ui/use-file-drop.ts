import { type DragEvent, useRef, useState } from 'react'

// Files dropped anywhere on a panel are attached by `attach`. While files are
// dragged over it, `dragging` is true, to show an outline. The counter copes
// with the drag entering and leaving the panel's own parts.
export function useFileDrop(attach: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const hasFiles = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')

  return {
    dragging,
    handlers: {
      onDragEnter(event: DragEvent) {
        if (!hasFiles(event)) return
        depth.current += 1
        setDragging(true)
      },
      onDragOver(event: DragEvent) {
        if (!hasFiles(event)) return
        // Allows the drop.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      },
      onDragLeave(event: DragEvent) {
        if (!hasFiles(event)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setDragging(false)
      },
      onDrop(event: DragEvent) {
        if (!hasFiles(event)) return
        event.preventDefault()
        depth.current = 0
        setDragging(false)
        attach(Array.from(event.dataTransfer.files))
      },
    },
  }
}
