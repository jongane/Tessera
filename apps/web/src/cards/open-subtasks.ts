import { ApiError } from '../api/client'

// The count in the API's 409 "subtasks are still open", else null.
export function openSubtasksOf(error: unknown): number | null {
  const count = error instanceof ApiError ? error.details.openSubtasks : null
  return error instanceof ApiError &&
    error.status === 409 &&
    typeof count === 'number'
    ? count
    : null
}
