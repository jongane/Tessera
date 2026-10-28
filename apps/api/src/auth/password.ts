import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt settings recommended by OWASP: slow and memory-hungry on purpose,
// so guessing passwords from a stolen database takes a very long time.
// They are saved in each hash, so they can be raised later without
// breaking existing passwords.
const COST = 2 ** 17;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEMORY = 256 * 1024 * 1024;

// "scrypt$<cost>$<block size>$<parallelism>$<salt>$<hash>", base64.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, COST, BLOCK_SIZE, PARALLELISM);
  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

// False for a wrong password, and for anything that is not a hash made by
// hashPassword.
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [cost, blockSize, parallelism] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  if (
    !isPositiveInteger(cost) ||
    !isPositiveInteger(blockSize) ||
    !isPositiveInteger(parallelism) ||
    salt.length === 0 ||
    expected.length !== KEY_LENGTH
  ) {
    return false;
  }
  const actual = await derive(password, salt, cost, blockSize, parallelism);
  return timingSafeEqual(actual, expected);
}

function derive(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelism: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFC'),
      salt,
      KEY_LENGTH,
      { N: cost, r: blockSize, p: parallelism, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

function isPositiveInteger(value: number | undefined): value is number {
  return Number.isInteger(value) && value! > 0;
}
