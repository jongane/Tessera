import type { CardRelatives, RelationColours } from '@tessera/shared'
import type { CardRelation } from './card-text'
import type { Highlight } from './CardTile'

// How each card on the board is shown while `openCardId` is open: the
// card itself and its relatives outlined in the project's colours, and the
// rest faded (docs/card-features.md, section 7). Deeper subtasks in the
// same colour as direct ones are drawn paler, so they still differ.
export function highlights(
  openCardId: string,
  relatives: CardRelatives,
  colours: RelationColours,
): (cardId: string) => Highlight {
  const relations = new Map<string, CardRelation>()
  for (const card of relatives.parents) {
    relations.set(card.id, 'parent')
  }
  for (const card of relatives.subtasks) {
    relations.set(card.id, card.level === 1 ? 'subtask' : 'deeperSubtask')
  }
  for (const card of relatives.siblings) {
    relations.set(card.id, 'sibling')
  }
  return (cardId) => {
    if (cardId === openCardId) {
      return {
        relation: null,
        colour: colours.selected,
        pale: false,
        faded: false,
      }
    }
    const relation = relations.get(cardId)
    if (!relation) {
      return { relation: null, colour: null, pale: false, faded: true }
    }
    return {
      relation,
      colour: colours[relation],
      pale:
        relation === 'deeperSubtask' &&
        colours.deeperSubtask === colours.subtask,
      faded: false,
    }
  }
}
