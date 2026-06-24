/**
 * WSO2-style hybrid encryption: RSA-OAEP-256 (encrypt AES key) + AES-256-GCM (payload).
 * Client fetches gateway RSA public key for optional encrypted client registration.
 * Data-plane auth uses OAuth2 Bearer JWT — not per-request client_secret.
 */

export type CryptoEnvelope = {
  encrypted_aes_key: string;
  nonce: string;
  ciphertext: string;
};

export type EncryptedCreateKeyPlain = {
  name: string;
  integration_type: string;
  secret_key?: string;
  rate_limit_per_min?: number;
  route_ids?: number[];
};

function pemToSpkiDer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s/g, '');
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export async function buildEncryptedEnvelope(
  publicKeyPem: string,
  plaintext: EncryptedCreateKeyPlain
): Promise<CryptoEnvelope> {
  const spki = pemToSpkiDer(publicKeyPem);
  const rsaKey = await crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'RSA-OAEP', hash: 'SHA-256' },
    false,
    ['encrypt']
  );

  const plainBytes = new TextEncoder().encode(JSON.stringify(plaintext));
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    aesKey,
    plainBytes
  );

  const rawAes = await crypto.subtle.exportKey('raw', aesKey);
  const encryptedAesKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaKey, rawAes);

  return {
    encrypted_aes_key: bufToB64(encryptedAesKey),
    nonce: bufToB64(nonce.buffer),
    ciphertext: bufToB64(ciphertext),
  };
}
