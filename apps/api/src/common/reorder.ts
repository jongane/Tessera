import { BadRequestException } from '@nestjs/common';

// The new [position, id] pairs after moving `movedId` to `toIndex`, counting
// from 0 at the top. An index past the end puts it last. `movedId` may be in
// `rows` already (moving within a list) or not (arriving from another list).
export function reorder(
  rows: { id: string }[],
  movedId: string,
  toIndex: number,
): [number, string][] {
  if (!Number.isInteger(toIndex) || toIndex < 0) {
    throw new BadRequestException('A position must be 0 or more');
  }
  const ids = rows.map((row) => row.id).filter((id) => id !== movedId);
  const index = Math.min(toIndex, ids.length);
  ids.splice(index, 0, movedId);
  return ids.map((id, position) => [position, id]);
}
