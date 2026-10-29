import { z } from 'zod';

// The API's database has the same list; a test there keeps them in step.
export const LABEL_COLOURS = [
  'GREY',
  'RED',
  'ORANGE',
  'YELLOW',
  'GREEN',
  'TEAL',
  'BLUE',
  'INDIGO',
  'PURPLE',
  'PINK',
] as const;

export type LabelColourName = (typeof LABEL_COLOURS)[number];

const nameField = z.string().trim().min(1).max(50);
const colourField = z.enum(LABEL_COLOURS);

export const newLabelSchema = z.strictObject({
  name: nameField,
  colour: colourField,
});

export const labelChangesSchema = z.strictObject({
  name: nameField.optional(),
  colour: colourField.optional(),
});

export type NewLabelBody = z.infer<typeof newLabelSchema>;
export type LabelChangesBody = z.infer<typeof labelChangesSchema>;
