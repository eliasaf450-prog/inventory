import crypto from 'node:crypto';

// גיבוב סיסמה באמצעות scrypt + מלח אקראי
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltHex, hashHex] = stored.split('$');
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = crypto.scryptSync(String(password), salt, 64);
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

export function newToken() {
  return crypto.randomBytes(32).toString('hex');
}
