import { randomInt } from "crypto";

const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnopqrstuvwxyz";
const DIGIT = "23456789";
const ALL = UPPER + LOWER + DIGIT;

function pick(chars: string): string {
  return chars[randomInt(chars.length)]!;
}

/**
 * Senha provisória legível (sem O/0/I/1) com maiúscula + número.
 * Cumpre senhaForteSchema do shared.
 */
export function generateProvisionalPassword(length = 10): string {
  const len = Math.max(8, length);
  const chars = [pick(UPPER), pick(DIGIT), pick(LOWER)];
  while (chars.length < len) chars.push(pick(ALL));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join("");
}
