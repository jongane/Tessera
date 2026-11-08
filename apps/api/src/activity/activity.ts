import type {
  ActivityCardRef,
  ActivityDetails,
  ActivityDue,
  ActivityPersonRef,
  ActivityTimeEntry,
} from '@tessera/shared';
import type { ActivityKind, Card, Prisma } from '../generated/prisma/client.js';

// Names are copied into each history line when it is written, so the line
// still reads correctly after a person, column or label is renamed.
// What each kind of history line records (docs/card-features.md, section 9)
// is declared once, in the shared package, so the API and the web app agree.
export type { ActivityDetails };
export type PersonRef = ActivityPersonRef;
export type CardRef = ActivityCardRef;
export type DueRef = ActivityDue;
export type TimeEntryRef = ActivityTimeEntry;

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
