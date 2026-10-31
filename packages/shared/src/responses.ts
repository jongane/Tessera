// What the API sends back, as the web app reads it. Plain types: the API
// and the web app are built together, so the answers are not checked again
// at run time. Dates arrive as ISO 8601 text, e.g. "2026-10-30T09:00:00.000Z".

import type { LabelColourName } from './labels.js';

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

// The body of every 4xx answer. `message` says what is wrong, in words that
// can be shown to people.
export interface ApiErrorBody {
  statusCode: number;
  message: string;
  error?: string;
}
