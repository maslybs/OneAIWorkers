const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EncryptedValue {
  version: 1;
  iv: string;
  ciphertext: string;
}

export function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

export function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

export function randomToken(bytes = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function encryptJson(masterKey: string, value: unknown, associatedData: string): Promise<EncryptedValue> {
  if (masterKey.length < 32) throw new Error("CREDENTIALS_MASTER_KEY must contain at least 32 characters.");
  const key = await importAesKey(masterKey, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(associatedData), tagLength: 128 },
    key,
    plaintext,
  );
  return {
    version: 1,
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  };
}

export async function decryptJson<T>(masterKey: string, encrypted: EncryptedValue, associatedData: string): Promise<T> {
  if (encrypted.version !== 1) throw new Error("Unsupported encrypted value version.");
  const key = await importAesKey(masterKey, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64UrlDecode(encrypted.iv),
      additionalData: encoder.encode(associatedData),
      tagLength: 128,
    },
    key,
    base64UrlDecode(encrypted.ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function verifyEcdsaTicket(publicKey: string, ticket: string): Promise<Record<string, unknown>> {
  const [encodedPayload, encodedSignature, extra] = ticket.split(".");
  if (!encodedPayload || !encodedSignature || extra) throw new Error("Invalid installation ticket.");
  const key = await crypto.subtle.importKey(
    "spki",
    parsePublicKey(publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    base64UrlDecode(encodedSignature),
    encoder.encode(encodedPayload),
  );
  if (!valid) throw new Error("Invalid installation ticket signature.");
  const payload = JSON.parse(decoder.decode(base64UrlDecode(encodedPayload))) as unknown;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid installation ticket payload.");
  return payload as Record<string, unknown>;
}

function parsePublicKey(value: string): ArrayBuffer {
  const clean = value
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!clean) throw new Error("PLUGIN_INSTALLER_PUBLIC_KEY is not configured.");
  const bytes = Uint8Array.from(atob(clean), (character) => character.charCodeAt(0));
  return bytes.buffer;
}

async function importAesKey(masterKey: string, keyUsages: KeyUsage[]): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(masterKey));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, keyUsages);
}
