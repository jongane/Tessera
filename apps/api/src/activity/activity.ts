import type {
  ActivityKind,
  Card,
  CardPriority,
  Prisma,
} from '../generated/prisma/client.js';

// Names are copied into each history line when it is written, so the line
// still reads correctly after a person, column or label is renamed.
export interface PersonRef {
  id: string;
  displayName: string;
}

export interface CardRef {
  id: string;
  numberPath: string;
  title: string;
}

export interface DueRef {
  // ISO time, or null for no due date.
  at: string | null;
  hasTime: boolean;
}

export interface TimeEntryRef {
  minutes: number;
  // YYYY-MM-DD
  workDate: string;
  note: string | null;
}

// What each kind of history line records (docs/card-features.md, section 9).
export interface ActivityDetails {
  CREATED: { numberPath: string; title: string };
  TITLE_CHANGED: { from: string; to: string };
  // Both texts are kept, so the screen can show what changed.
  DESCRIPTION_CHANGED: { from: string | null; to: string | null };
  PRIORITY_CHANGED: { from: CardPriority; to: CardPriority };
  DUE_DATE_CHANGED: { from: DueRef; to: DueRef };
  ESTIMATE_CHANGED: { from: number | null; to: number | null };
  MOVED: {
    from: { columnId: string; name: string };
    to: { columnId: string; name: string };
  };
  COMPLETED: Record<string, never>;
  REOPENED: Record<string, never>;
  ASSIGNEE_ADDED: { user: PersonRef; isOwner: boolean };
  ASSIGNEE_REMOVED: { user: PersonRef };
  OWNER_CHANGED: { from: PersonRef | null; to: PersonRef | null };
  LABEL_ADDED: { labelId: string; name: string; colour: string };
  LABEL_REMOVED: { labelId: string; name: string; colour: string };
  SUBTASK_ADDED: { subtask: CardRef };
  // deleted is false when the subtask moved to another parent.
  SUBTASK_REMOVED: { subtask: CardRef; deleted: boolean };
  PARENT_CHANGED: { from: CardRef | null; to: CardRef | null };
  NUMBER_CHANGED: { from: string; to: string };
  TIME_LOGGED: {
    entryId: string;
    user: PersonRef;
    fromTimer: boolean;
  } & TimeEntryRef;
  TIME_ENTRY_EDITED: {
    entryId: string;
    user: PersonRef;
    from: TimeEntryRef;
    to: TimeEntryRef;
  };
  TIME_ENTRY_DELETED: { entryId: string; user: PersonRef } & TimeEntryRef;
  CHECKLIST_ADDED: { checklistId: string; name: string };
  CHECKLIST_RENAMED: { checklistId: string; from: string; to: string };
  CHECKLIST_DELETED: { checklistId: string; name: string };
  CHECKLIST_ITEM_TO_SUBTASK: {
    checklistId: string;
    checklistName: string;
    subtask: CardRef;
  };
}

// Writes one history line. Call it inside the transaction that makes the
// change, so the change and its history are saved together or not at all.
export async function recordActivity<K extends ActivityKind>(
  tx: Prisma.TransactionClient,
  card: Pick<Card, 'id' | 'projectId'>,
  actorId: string | null,
  kind: K,
  details: ActivityDetails[K],
): Promise<void> {
  await tx.cardActivity.create({
    data: {
      cardId: card.id,
      projectId: card.projectId,
      actorId,
      kind,
      details: details as unknown as Prisma.InputJsonValue,
    },
  });
}

export function cardRef(
  card: Pick<Card, 'id' | 'numberPath' | 'title'>,
): CardRef {
  return { id: card.id, numberPath: card.numberPath, title: card.title };
}

export function dueRef(card: Pick<Card, 'dueAt' | 'dueHasTime'>): DueRef {
  return { at: card.dueAt?.toISOString() ?? null, hasTime: card.dueHasTime };
}

export function timeEntryRef(entry: {
  minutes: number;
  workDate: Date;
  note: string | null;
}): TimeEntryRef {
  return {
    minutes: entry.minutes,
    workDate: entry.workDate.toISOString().slice(0, 10),
    note: entry.note,
  };
}

export async function personRef(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<PersonRef> {
  return tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, displayName: true },
  });
}
