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
  save(next)
}

function save(boards: LastBoards) {
  try {
    localStorage.setItem(KEY, JSON.stringify(boards))
  } catch {
    // Storage blocked (for example a private window): nothing is remembered.
  }
}

// Only an address of a board in this app: a damaged or changed value
// could otherwise lead to another website.
const BOARD_PATH = /^\/[A-Za-z]{2,6}\/boards\/[0-9a-f-]{36}$/

export function lastBoardPath(): string | undefined {
  const { path } = read()
  return typeof path === 'string' && BOARD_PATH.test(path) ? path : undefined
}

// A board that has gone, or that the person can no longer see.
export function forgetBoard(projectCode: string, boardId: string) {
  const saved = read()
  const byProject = { ...saved.byProject }
  if (byProject[projectCode] === boardId) {
    delete byProject[projectCode]
  }
  const next: LastBoards = {
    path:
      saved.path === `/${projectCode}/boards/${boardId}`
        ? undefined
        : saved.path,
    byProject,
  }
  save(next)
}

export function lastBoardIn(projectCode: string): string | undefined {
  const id = read().byProject?.[projectCode]
  return typeof id === 'string' ? id : undefined
}

// After leaving a project: none of its boards open any more.
export function forgetProject(projectCode: string) {
  const saved = read()
  const byProject = { ...saved.byProject }
  delete byProject[projectCode]
  save({
    path: saved.path?.startsWith(`/${projectCode}/`) ? undefined : saved.path,
    byProject,
  })
}

// After a project's code changes, its remembered boards move with it.
export function renameProject(oldCode: string, newCode: string) {
  const saved = read()
  const { [oldCode]: boardId, ...byProject } = saved.byProject ?? {}
  if (boardId !== undefined) {
    byProject[newCode] = boardId
  }
  save({
    path: saved.path?.startsWith(`/${oldCode}/`)
      ? `/${newCode}/${saved.path.slice(oldCode.length + 2)}`
      : saved.path,
    byProject,
  })
}
