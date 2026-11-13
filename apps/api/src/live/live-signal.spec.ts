import {
  boardSignal,
  cardSignal,
  chatsSignal,
  connectionIdFrom,
  messageSignal,
} from './live-signal.js';

// Live updates PR (plan "live updates"): the signals the server sends. A
// signal says only what changed, never text or names (criterion 5).
const BOARD = '33333333-3333-4333-8333-333333333333';
const CARD = '11111111-1111-4111-8111-111111111111';
const CHAT = '55555555-5555-4555-8555-555555555555';
const MESSAGE = '66666666-6666-4666-8666-666666666666';

describe('live signals', () => {
  // 5, 6
  it('makes a card signal with the board and the card', () => {
    expect(cardSignal(BOARD, CARD, 'conn-1')).toEqual({
      type: 'card',
      boardId: BOARD,
      cardId: CARD,
      by: 'conn-1',
    });
  });

  // 5, 6
  it('makes a board signal with only the board', () => {
    expect(boardSignal(BOARD, 'conn-1')).toEqual({
      type: 'board',
      boardId: BOARD,
      by: 'conn-1',
    });
  });

  // 5, 8
  it('makes a chats signal with only the board', () => {
    expect(chatsSignal(BOARD, 'conn-1')).toEqual({
      type: 'chats',
      boardId: BOARD,
      by: 'conn-1',
    });
  });

  // 5, 9
  it('makes a message signal with the board, the chat and the message', () => {
    expect(messageSignal(BOARD, CHAT, MESSAGE, 'conn-1')).toEqual({
      type: 'message',
      boardId: BOARD,
      chatId: CHAT,
      messageId: MESSAGE,
      by: 'conn-1',
    });
  });

  // 5
  it('has `by` null when the save came without a connection id', () => {
    expect(cardSignal(BOARD, CARD, null).by).toBeNull();
    expect(boardSignal(BOARD, null).by).toBeNull();
    expect(chatsSignal(BOARD, null).by).toBeNull();
    expect(messageSignal(BOARD, CHAT, MESSAGE, null).by).toBeNull();
  });

  // 5
  it('holds nothing but ids and `by`', () => {
    const everything = [
      cardSignal(BOARD, CARD, 'c'),
      boardSignal(BOARD, 'c'),
      chatsSignal(BOARD, 'c'),
      messageSignal(BOARD, CHAT, MESSAGE, 'c'),
    ];
    for (const signal of everything) {
      for (const key of Object.keys(signal)) {
        expect([
          'type',
          'boardId',
          'cardId',
          'chatId',
          'messageId',
          'by',
        ]).toContain(key);
      }
    }
  });
});

describe('the connection id of a save', () => {
  // 5
  it('is the value of the X-Live-Connection header', () => {
    expect(connectionIdFrom('conn-1')).toBe('conn-1');
  });

  // 5
  it('is null when the header is missing or empty', () => {
    expect(connectionIdFrom(undefined)).toBeNull();
    expect(connectionIdFrom('')).toBeNull();
    expect(connectionIdFrom('   ')).toBeNull();
  });
});
