async function getSubtleCrypto() {
  if (globalThis?.crypto?.subtle) return globalThis.crypto.subtle;
  const nodeCrypto = await import('crypto');
  return nodeCrypto.webcrypto.subtle;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(length = 16) {
  if (globalThis?.crypto?.getRandomValues) {
    const bytes = new Uint8Array(length);
    globalThis.crypto.getRandomValues(bytes);
    return bytesToHex(bytes);
  }

  const chars = 'abcdef0123456789';
  let out = '';
  for (let i = 0; i < length * 2; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function generateMarketplacePasswordSalt() {
  return randomHex(16);
}

export async function hashMarketplacePassword(password, salt) {
  const subtle = await getSubtleCrypto();
  const encoder = new TextEncoder();
  const input = encoder.encode(`${salt || ''}:${password || ''}`);
  const digest = await subtle.digest('SHA-256', input);
  return bytesToHex(new Uint8Array(digest));
}

export async function createMarketplacePasswordSecret(password) {
  const passwordSalt = generateMarketplacePasswordSalt();
  const passwordHash = await hashMarketplacePassword(password, passwordSalt);
  return { passwordSalt, passwordHash };
}

export async function createMarketplaceJoinProof(password, passwordSalt) {
  return hashMarketplacePassword(password, passwordSalt);
}

