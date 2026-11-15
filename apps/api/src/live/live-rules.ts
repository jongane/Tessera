import { SESSION_COOKIE } from '../auth/session-cookie.js';
import { hashToken } from '../auth/session-token.js';
import type { LiveService, SignalPlan } from './live.service.js';

// What the live signals know about a save, before it runs.
export interface RuleContext {
  live: LiveService;
  by: string | null;
  userId: string | undefined;
  params: Record<string, string>;
  body: Record<string, unknown> | undefined;
  cookies: Record<string, string> | undefined;
  query: Record<string, unknown>;
  statusCode: () => number;
}

// Runs before the save (some things are gone afterwards), and answers with
// what to do once the save has worked. A save that fails sends nothing.
type After = (result: unknown) => Promise<void> | void;
export type Rule = (context: RuleContext) => Promise<After> | After;

const idOf = (result: unknown): string => (result as { id: string }).id;

// A change to a card: it, the cards above it, and optionally the board.
const card =
  (cardId: (c: RuleContext) => string, options = {}): Rule =>
  (c) =>
  async () => {
    c.live.send(c.by, await c.live.plan([cardId(c)], options));
  };

// A change to a card found through something on it, which a delete removes.
const cardThrough =
  (find: (c: RuleContext) => Promise<string | null>): Rule =>
  async (c) => {
    const cardId = await find(c);
    return async () => {
      c.live.send(c.by, await c.live.plan(cardId ? [cardId] : []));
    };
  };

const cardParam = (c: RuleContext) => c.params['cardId']!;

// Create a card, and anything made with one: it, its board and its chat.
const createsCard =
  (also: (c: RuleContext) => string[]): Rule =>
  (c) =>
  async (result) => {
    const options = { board: true, chats: true };
    c.live.send(c.by, await c.live.plan([idOf(result), ...also(c)], options));
  };

const sendsMessage: Rule = async (c) => {
  const info = await c.live.chatInfo(c.params['chatId']!);
  return (result) => {
    // Sending the same message again saves nothing new.
    if (info && c.statusCode() === 201) {
      c.live.sendMessage(
        c.by,
        { boardId: info.boardId, chatId: c.params['chatId']! },
        idOf(result),
      );
    }
  };
};

const changesMessage: Rule = async (c) => {
  const info = await c.live.messageInfo(c.params['messageId']!);
  return () => {
    if (info) {
      c.live.sendMessage(c.by, info, c.params['messageId']!);
    }
  };
};

// Linking or unlinking a chat: the chat list, and the card it was or is on.
const linksChat: Rule = async (c) => {
  const before = await c.live.chatInfo(c.params['chatId']!);
  return async () => {
    const cardIds = [before?.cardId, c.body?.['cardId']].filter(
      (id): id is string => typeof id === 'string',
    );
    c.live.send(c.by, await c.live.plan(cardIds));
    if (before) {
      c.live.sendChats(c.by, before.boardId);
    }
  };
};

// A card, with everything below it, that is about to leave a place: the
// cards above it only see the change once it is done.
const movesCardTree: Rule = async (c) => {
  const options = { board: true, below: true };
  const before: SignalPlan = await c.live.plan([cardParam(c)], options);
  return async () => {
    const after = await c.live.plan([cardParam(c)], options);
    c.live.send(c.by, c.live.merge(before, after));
  };
};

const timer: Rule = async (c) => {
  const running = await c.live.cardOfRunningTimer(c.userId ?? '');
  return async () => {
    const ids = [c.params['cardId'], running].filter(
      (id): id is string => typeof id === 'string',
    );
    c.live.send(c.by, await c.live.plan(ids));
  };
};

// "METHOD path", the path as the controller declares it, without /api.
export const liveRules: Record<string, Rule> = {
  'POST columns/:columnId/cards': createsCard(() => []),
  'PATCH cards/:cardId': card(cardParam),
  'POST cards/:cardId/move': card(cardParam, { board: true }),
  'POST cards/:cardId/complete': card(cardParam),
  'POST cards/:cardId/reopen': card(cardParam),
  'DELETE cards/:cardId': async (c) => {
    const plan = await c.live.plan([cardParam(c)], {
      board: true,
      chats: true,
      below: true,
    });
    return async () => {
      // Subtasks moved under another card: that card and its board change.
      const choices = (c.body?.['subtasks'] ?? {}) as Record<
        string,
        { action?: string; parentId?: string }
      >;
      // The card that took the files of the deleted card changes too.
      const parents = [
        ...Object.values(choices).map((choice) => choice.parentId),
        c.query['moveFilesTo'],
      ].filter((id): id is string => typeof id === 'string');
      const moved = await c.live.plan(parents, { board: true });
      c.live.send(c.by, c.live.merge(plan, moved));
    };
  },
  'PATCH columns/:columnId': async (c) => {
    const boardId = await c.live.boardOfColumn(c.params['columnId']!);
    return () => {
      if (boardId) {
        c.live.sendBoard(c.by, boardId);
      }
    };
  },
  'POST cards/:cardId/subtasks': createsCard((c) => [cardParam(c)]),
  'PUT cards/:cardId/parent': movesCardTree,

  'PUT cards/:cardId/assignees/:userId': card(cardParam),
  'DELETE cards/:cardId/assignees/:userId': card(cardParam),
  'PUT cards/:cardId/owner': card(cardParam),
  'PUT cards/:cardId/labels/:labelId': card(cardParam),
  'DELETE cards/:cardId/labels/:labelId': card(cardParam),

  'POST cards/:cardId/checklists': card(cardParam),
  'PATCH checklists/:checklistId': cardThrough((c) =>
    c.live.cardOfChecklist(c.params['checklistId']!),
  ),
  'DELETE checklists/:checklistId': cardThrough((c) =>
    c.live.cardOfChecklist(c.params['checklistId']!),
  ),
  'POST checklists/:checklistId/items': cardThrough((c) =>
    c.live.cardOfChecklist(c.params['checklistId']!),
  ),
  'PATCH checklist-items/:itemId': cardThrough((c) =>
    c.live.cardOfItem(c.params['itemId']!),
  ),
  'DELETE checklist-items/:itemId': cardThrough((c) =>
    c.live.cardOfItem(c.params['itemId']!),
  ),
  'POST checklist-items/:itemId/subtask': async (c) => {
    const cardId = await c.live.cardOfItem(c.params['itemId']!);
    return async (result) => {
      const ids = cardId ? [cardId, idOf(result)] : [idOf(result)];
      c.live.send(c.by, await c.live.plan(ids, { board: true, chats: true }));
    };
  },

  'POST cards/:cardId/files': card(cardParam),
  'DELETE files/:fileId': cardThrough((c) =>
    c.live.cardOfFile(c.params['fileId']!),
  ),

  'POST cards/:cardId/time-entries': card(cardParam),
  'PATCH time-entries/:entryId': cardThrough((c) =>
    c.live.cardOfEntry(c.params['entryId']!),
  ),
  'DELETE time-entries/:entryId': cardThrough((c) =>
    c.live.cardOfEntry(c.params['entryId']!),
  ),
  'POST cards/:cardId/timer': timer,
  'DELETE timer': cardThrough((c) => c.live.cardOfRunningTimer(c.userId ?? '')),

  'POST boards/:boardId/chats': (c) => () =>
    c.live.sendChats(c.by, c.params['boardId']!),
  'PUT chats/:chatId/card': linksChat,
  'DELETE chats/:chatId/card': linksChat,

  'POST chats/:chatId/messages': sendsMessage,
  'PATCH messages/:messageId': changesMessage,
  'DELETE messages/:messageId': changesMessage,

  'DELETE projects/:projectId/members/:userId': (c) => async () => {
    await c.live.leaveProject(c.params['projectId']!, c.params['userId']!);
  },
  'POST auth/password': (c) => async () => {
    if (c.userId) {
      await c.live.endEndedSessions(c.userId);
    }
  },
  'POST auth/sign-out': (c) => async () => {
    const token = c.cookies?.[SESSION_COOKIE];
    if (token) {
      await c.live.endSession(hashToken(token));
    }
  },
};
