// The last board used, remembered in this browser for now. It must move to
// the person's account later, with the panel positions (docs/web-app.md,
// sections 2 and 3).

const KEY = 'tessera.lastBoard'

interface LastBoards {
  // The address of the last board used in any project.
  path?: string
  // The last board used in each project, by project code.
  byProject?: Record<string, string>
}

function read(): LastBoards {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    return saved && typeof saved === 'object' ? (saved as LastBoards) : {}
  } catch {
    // Storage blocked or the value damaged: start afresh.
    return {}
  }
}

export function rememberBoard(projectCode: string, boardId: string) {
  const saved = read()
  const next: LastBoards = {
    path: `/${projectCode}/boards/${boardId}`,
    byProject: { ...saved.byProject, [projectCode]: boardId },
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage blocked (for example a private window): nothing is remembered.
  }
}

export function lastBoardPath(): string | undefined {
  const { path } = read()
  return typeof path === 'string' && path.startsWith('/') ? path : undefined
}

export function lastBoardIn(projectCode: string): string | undefined {
  const id = read().byProject?.[projectCode]
  return typeof id === 'string' ? id : undefined
}
