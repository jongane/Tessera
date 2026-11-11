// What the API sends back, as the web app reads it. Plain types: the API
// and the web app are built together, so the answers are not checked again
// at run time. Dates arrive as ISO 8601 text, e.g. "2026-10-30T09:00:00.000Z".

import type { LabelColourName } from './labels.js';
import type { RelationColours } from './projects.js';

// The signed-in person (GET /api/auth/me, sign-in and sign-up).
export interface Me {
  id: string;
  email: string;
  displayName: string;
  isServerAdmin: boolean;
}

// GET /api/server/settings
export interface ServerSettings {
  signUpOpen: boolean;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  code: string;
  timeZone: string;
  // Set by project admins (docs/card-features.md, section 7).
  relationColours: RelationColours;
  createdAt: string;
}

export type ProjectRole = 'ADMIN' | 'MEMBER';

// GET /api/projects/:projectId/members, admins first, then by name.
export interface ProjectMember {
  userId: string;
  displayName: string;
  email: string;
  role: ProjectRole;
  joinedAt: string;
}

// GET /api/projects/:projectId/labels, by name.
export interface Label {
  id: string;
  projectId: string;
  name: string;
  colour: LabelColourName;
  createdAt: string;
}

// GET /api/projects/suggest-code
export interface SuggestedCode {
  code: string;
}

export interface Board {
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
}

export type CardPriority = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

// A card's own fields.
export interface Card {
  id: string;
  projectId: string;
  boardId: string;
  columnId: string;
  // The number without the project code: "12", or "12.1" for a subtask.
  numberPath: string;
  parentId: string | null;
  // 0 for a top-level card, 1 for its subtasks, and so on.
  depth: number;
  title: string;
  description: string | null;
  priority: CardPriority;
  estimateMinutes: number | null;
  dueAt: string | null;
  // False when only a day is set (dueAt is then midnight UTC of that day).
  dueHasTime: boolean;
  isComplete: boolean;
  completedAt: string | null;
  // 0 is the top of the column.
  position: number;
  createdById: string | null;
  createdAt: string;
}

// GET /api/cards/:cardId and PATCH /api/cards/:cardId.
export interface CardView extends Card {
  // With the project code, e.g. "WEB-12.1".
  number: string;
  chat: { id: string; title: string } | null;
}

// POST /api/cards/:cardId/complete
export interface CompleteCardResult {
  card: Card;
  // The board's done column to offer moving the card to, or null when the
  // card is already in one or the board has none.
  doneColumnId: string | null;
}

// One row of GET /api/cards/:cardId/subtasks: the subtask's own fields plus
// what the Subtasks list shows, so it needs no extra request per row.
export interface SubtaskListItem extends Card {
  // With the project's current code, e.g. "WEB-12.1".
  number: string;
  // The subtask's own column and board, which may be another board of the
  // project.
  columnName: string;
  boardName: string;
  // The subtask's own direct subtasks only.
  subtaskProgress: { complete: number; total: number };
}

// GET /api/cards/:cardId/subtasks
export interface SubtaskList {
  // Direct subtasks, in number order.
  subtasks: SubtaskListItem[];
  progress: { complete: number; total: number };
}

// GET /api/cards/:cardId/time-totals
export interface CardTotals {
  // The card's own estimate or, for a card with subtasks, the sum of
  // theirs at every level. Null when nothing has an estimate.
  estimateMinutes: number | null;
  // A card with subtasks keeps its own estimate, shown greyed out. Null for
  // a card without subtasks.
  originalEstimateMinutes: number | null;
  timeSpentMinutes: number;
  ownTimeMinutes: number;
}

// A card related to another one, wherever it is in the project.
export interface RelatedCard {
  id: string;
  // With the project code, e.g. "WEB-12.1".
  number: string;
  title: string;
  boardId: string;
  boardName: string;
  isComplete: boolean;
}

// GET /api/cards/:cardId/relatives (docs/card-features.md, section 7).
export interface CardRelatives {
  // The parent first, then its parent, up to the top.
  parents: RelatedCard[];
  // Every level below, in number order. `level` 1 is a direct subtask.
  subtasks: (RelatedCard & { level: number })[];
  // The other subtasks of the same parent, in number order.
  siblings: RelatedCard[];
}

// GET /api/projects/:projectId/cards?q=... Cards whose number matches come
// first (the card, then its subtasks), then cards whose title matches, each
// group in number order. When more titles match than fit, the newest cards
// are the ones given.
export interface CardSearchResults {
  cards: (RelatedCard & {
    // 0 for a top-level card, 1 for its subtasks, and so on (at most 4), so
    // a picker can tell which parents are already too deep.
    depth: number;
  })[];
}

// A card as the board shows it (GET /api/boards/:boardId).
export interface BoardCard extends Card {
  // With the project code, e.g. "WEB-12.1".
  number: string;
  // In name order.
  labels: { id: string; name: string; colour: LabelColourName }[];
  // The owner first, then in the order they were assigned.
  assignees: { id: string; displayName: string; isOwner: boolean }[];
  // Items ticked off across all the card's checklists.
  checklistProgress: { done: number; total: number };
  // Direct subtasks only.
  subtaskProgress: { complete: number; total: number };
  chatId: string | null;
}

export interface BoardColumn {
  id: string;
  boardId: string;
  name: string;
  position: number;
  // Moving a card into a done column completes it.
  isDone: boolean;
  createdAt: string;
  // From the top of the column down.
  cards: BoardCard[];
}

// GET /api/boards/:boardId
export interface BoardView extends Board {
  // Left to right.
  columns: BoardColumn[];
}

// GET /api/boards/:boardId/chats. A GENERAL chat is the board's own
// and is never linked to a card; any other may be linked to one card.
export interface Chat {
  id: string;
  boardId: string;
  cardId: string | null;
  kind: 'GENERAL' | 'TOPIC';
  title: string;
  createdAt: string;
}

// A person as a message shows them: the author, or whoever deleted it.
export interface MessagePerson {
  id: string;
  displayName: string;
}

// One chat message (docs/api.md, "Messages"). A deleted message keeps its
// body; the web app shows it crossed out. `author` and `deletedBy` are null
// once that person's account has been deleted.
export interface Message {
  id: string;
  chatId: string;
  // Markdown.
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  author: MessagePerson | null;
  deletedBy: MessagePerson | null;
}

// GET /api/chats/:chatId/messages: the newest 50 (or the 50 before a given
// message), oldest first.
export interface MessagePage {
  messages: Message[];
  hasOlder: boolean;
}

// One tick-box item of a checklist (docs/api.md, "Checklists").
// POST /api/checklists/:checklistId/items and PATCH
// /api/checklist-items/:itemId answer with one.
export interface ChecklistItem {
  id: string;
  checklistId: string;
  text: string;
  isDone: boolean;
  // 0 is the top of the checklist.
  position: number;
  createdAt: string;
}

// A checklist's own fields.
export interface Checklist {
  id: string;
  cardId: string;
  projectId: string;
  name: string;
  // 0 is the card's first checklist.
  position: number;
  createdAt: string;
}

// GET /api/cards/:cardId/checklists, in order.
export interface ChecklistWithItems extends Checklist {
  // In order.
  items: ChecklistItem[];
  // "2 of 4". Shown only on this card; never counted in a parent's progress.
  progress: { done: number; total: number };
}

// POST /api/cards/:cardId/checklists
export interface NewChecklist extends Checklist {
  // True once the card has more than 10 checklists, so the screen can
  // suggest a new card. Nothing is refused.
  suggestNewCard: boolean;
}

// One piece of logged time (docs/api.md, "Time"). POST
// /api/cards/:cardId/time-entries and PATCH /api/time-entries/:entryId
// answer with one.
export interface TimeEntry {
  id: string;
  projectId: string;
  cardId: string;
  userId: string;
  // The day worked, as midnight UTC of that day ("2026-11-02T00:00:00.000Z").
  workDate: string;
  minutes: number;
  note: string | null;
  // Set when the timer made the entry.
  startedAt: string | null;
  endedAt: string | null;
  // A timer that ran over 24 hours is flagged until someone confirms it.
  needsReview: boolean;
  createdAt: string;
}

// GET /api/cards/:cardId/time-entries, latest day first.
export interface TimeEntryWithPerson extends TimeEntry {
  user: { id: string; displayName: string };
}

// Someone's running timer.
export interface RunningTimer {
  userId: string;
  projectId: string;
  cardId: string;
  startedAt: string;
  workDate: string;
}

// GET /api/timer
export interface TimerState {
  timer: RunningTimer | null;
}

// POST /api/cards/:cardId/timer. `savedEntry` is the time saved from a timer
// that was stopped to start this one.
export interface StartTimerResult {
  timer: RunningTimer;
  savedEntry: TimeEntry | null;
}

// DELETE /api/timer. `entry` is null when the timer ran under half a minute.
export interface StopTimerResult {
  entry: TimeEntry | null;
}

// The body of every 4xx answer. `message` says what is wrong, in words that
// can be shown to people.
export interface ApiErrorBody {
  statusCode: number;
  message: string;
  error?: string;
}

// A card's history (GET /api/cards/:cardId/activity). Names are copied into
// each line when it is written, so a line reads as it did at the time.
export interface ActivityPersonRef {
  id: string;
  displayName: string;
}

export interface ActivityCardRef {
  id: string;
  numberPath: string;
  title: string;
}

export interface ActivityDue {
  // ISO time, or null for no due date.
  at: string | null;
  hasTime: boolean;
}

export interface ActivityTimeEntry {
  minutes: number;
  // YYYY-MM-DD
  workDate: string;
  note: string | null;
}

// What each kind of history line records.
export interface ActivityDetails {
  CREATED: { numberPath: string; title: string };
  TITLE_CHANGED: { from: string; to: string };
  DESCRIPTION_CHANGED: { from: string | null; to: string | null };
  PRIORITY_CHANGED: { from: CardPriority; to: CardPriority };
  DUE_DATE_CHANGED: { from: ActivityDue; to: ActivityDue };
  ESTIMATE_CHANGED: { from: number | null; to: number | null };
  MOVED: {
    from: { columnId: string; name: string };
    to: { columnId: string; name: string };
  };
  COMPLETED: Record<string, never>;
  REOPENED: Record<string, never>;
  ASSIGNEE_ADDED: { user: ActivityPersonRef; isOwner: boolean };
  ASSIGNEE_REMOVED: { user: ActivityPersonRef };
  OWNER_CHANGED: {
    from: ActivityPersonRef | null;
    to: ActivityPersonRef | null;
  };
  LABEL_ADDED: { labelId: string; name: string; colour: string };
  LABEL_REMOVED: { labelId: string; name: string; colour: string };
  SUBTASK_ADDED: { subtask: ActivityCardRef };
  // deleted is false when the subtask moved to another parent.
  SUBTASK_REMOVED: { subtask: ActivityCardRef; deleted: boolean };
  PARENT_CHANGED: { from: ActivityCardRef | null; to: ActivityCardRef | null };
  NUMBER_CHANGED: { from: string; to: string };
  TIME_LOGGED: {
    entryId: string;
    user: ActivityPersonRef;
    fromTimer: boolean;
  } & ActivityTimeEntry;
  TIME_ENTRY_EDITED: {
    entryId: string;
    user: ActivityPersonRef;
    from: ActivityTimeEntry;
    to: ActivityTimeEntry;
  };
  TIME_ENTRY_DELETED: {
    entryId: string;
    user: ActivityPersonRef;
  } & ActivityTimeEntry;
  CHECKLIST_ADDED: { checklistId: string; name: string };
  CHECKLIST_RENAMED: { checklistId: string; from: string; to: string };
  CHECKLIST_DELETED: { checklistId: string; name: string };
  CHECKLIST_ITEM_TO_SUBTASK: {
    checklistId: string;
    checklistName: string;
    subtask: ActivityCardRef;
  };
}

export type ActivityKind = keyof ActivityDetails;

// One history line. The kind decides the shape of `details`.
export type ActivityLine = {
  [K in ActivityKind]: {
    id: string;
    kind: K;
    details: ActivityDetails[K];
    // Null once the person has been deleted.
    actor: ActivityPersonRef | null;
    createdAt: string;
  };
}[ActivityKind];

export interface ActivityPage {
  // Newest first.
  items: ActivityLine[];
  // Pass as `before` to get the next, older page; null on the last page.
  nextBefore: string | null;
}
