// A subtask can be at most this deep (docs/card-features.md, section 4), so
// a card this deep can't get subtasks.
export const DEEPEST_PARENT = 4

export const TOO_DEEP = `Subtasks can only go ${DEEPEST_PARENT + 1} levels deep`
