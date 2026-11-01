import { z } from 'zod';
import { LABEL_COLOURS } from './labels.js';

// The project's own code rules (2 to 6 letters) are checked by the API's
// ProjectsService, which gives a clearer message.
const codeField = z.string().max(20);

export const newProjectSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).optional(),
  code: codeField,
});

// The colours that outline a selected card's relatives on the board
// (docs/card-features.md, section 7): the 10 label colours, which read well
// in light and dark mode, plus dark for the selected card.
export const RELATION_COLOURS = [...LABEL_COLOURS, 'DARK'] as const;
export type RelationColourName = (typeof RELATION_COLOURS)[number];

export const RELATIONS = [
  'selected',
  'parent',
  'subtask',
  'deeperSubtask',
  'sibling',
] as const;
export type Relation = (typeof RELATIONS)[number];
export type RelationColours = Record<Relation, RelationColourName>;

// What a new project starts with (docs/card-features.md, section 7).
export const DEFAULT_RELATION_COLOURS: RelationColours = {
  selected: 'DARK',
  parent: 'BLUE',
  subtask: 'ORANGE',
  deeperSubtask: 'ORANGE',
  sibling: 'GREY',
};

const relationColour = z.enum(RELATION_COLOURS).optional();

export const projectChangesSchema = z.strictObject({
  code: codeField.optional(),
  timeZone: z.string().refine(isKnownTimeZone, 'Unknown time zone').optional(),
  // Only the relationships given change.
  relationColours: z
    .strictObject({
      selected: relationColour,
      parent: relationColour,
      subtask: relationColour,
      deeperSubtask: relationColour,
      sibling: relationColour,
    })
    .optional(),
});

export const suggestCodeQuerySchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
});

export type NewProjectBody = z.infer<typeof newProjectSchema>;
export type ProjectChanges = z.infer<typeof projectChangesSchema>;
export type SuggestCodeQuery = z.infer<typeof suggestCodeQuerySchema>;

// An IANA time zone name such as "Europe/London".
function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}
