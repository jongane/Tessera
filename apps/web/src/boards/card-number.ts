// A card number such as WEB-12, WEB-12.1 or an old number.
const CARD_NUMBER = /^[A-Za-z]{2,6}-[1-9][0-9]*(\.[1-9][0-9]*)*$/

export function isCardNumber(value: string): boolean {
  return CARD_NUMBER.test(value)
}
