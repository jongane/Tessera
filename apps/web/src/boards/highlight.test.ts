import { DEFAULT_RELATION_COLOURS, type RelatedCard } from '@tessera/shared'
import { describe, expect, it } from 'vitest'
import { highlights } from './highlight'

function card(id: string): RelatedCard {
  return {
    id,
    number: `WEB-${id}`,
    title: id,
    boardId: 'b',
    boardName: 'Sprint 1',
    isComplete: false,
  }
}

const relatives = {
  parents: [card('parent'), card('grandparent')],
  subtasks: [
    { ...card('child'), level: 1 },
    { ...card('grandchild'), level: 2 },
  ],
  siblings: [card('sibling')],
}

describe('highlights', () => {
  it('outlines the open card and each relative in its colour, fading the rest', () => {
    const of = highlights('open', relatives, DEFAULT_RELATION_COLOURS)

    expect(of('open')).toMatchObject({ colour: 'DARK', relation: null })
    expect(of('parent')).toMatchObject({ relation: 'parent', colour: 'BLUE' })
    expect(of('grandparent')).toMatchObject({ relation: 'parent' })
    expect(of('child')).toMatchObject({ relation: 'subtask', pale: false })
    expect(of('sibling')).toMatchObject({ relation: 'sibling', colour: 'GREY' })
    expect(of('stranger')).toEqual({
      relation: null,
      colour: null,
      pale: false,
      faded: true,
    })
  })

  it('draws deeper subtasks paler only when they share the subtask colour', () => {
    const same = highlights('open', relatives, DEFAULT_RELATION_COLOURS)
    const different = highlights('open', relatives, {
      ...DEFAULT_RELATION_COLOURS,
      deeperSubtask: 'PINK',
    })

    expect(same('grandchild')).toMatchObject({
      relation: 'deeperSubtask',
      colour: 'ORANGE',
      pale: true,
    })
    expect(different('grandchild')).toMatchObject({
      colour: 'PINK',
      pale: false,
    })
  })
})
