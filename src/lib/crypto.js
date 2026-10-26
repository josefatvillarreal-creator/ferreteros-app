// ---------------------------------------------------------------------------
// Cifrado en reposo para almacenamiento offline (Web Crypto — AES-GCM 256).
// ---------------------------------------------------------------------------
// Requisito Protexa: los datos de la visita (foto en Base64, inventario, etc.)
// NUNCA deben quedar en texto plano en el dispositivo del promotor.
//
// Diseño de la clave:
//   - Se genera una clave AES-GCM de 256 bits con `extractable: false`.
//   - Se persiste el objeto CryptoKey en IndexedDB (structured clone). Al ser
//     NO EXPORTABLE, el material crudo de la clave nunca puede leerse desde JS
//     (ni siquiera un XSS puede exfiltrarla), y sobrevive a recargas y a estar
//     offline (no depende del servidor).
//   - Cada cifrado usa un IV aleatorio de 96 bits (nonce único por operación).
//
// Modelo de amenaza (honesto): esto protege los datos EN REPOSO (inspección del
// IndexedDB, backups del dispositivo, otra app leyendo el store). NO protege
// contra malware que ejecute JS dentro de la página con la sesión abierta —
// ningún esquema de cliente puede hacerlo, pues necesitaría descifrar en vivo.
import localforage from "localforage";

const KEY_ID = "aes-gcm-visitas-v1";

// Store dedicado SOLO para la clave. Forzamos IndexedDB porque los drivers de
// localStorage/WebSQL serializan a texto y no pueden guardar un CryptoKey.
const keyStore = localforage.createInstance({
  name: "promotores",
  storeName: "secure_keys",
  driver: localforage.INDEXEDDB,
});

let keyPromise = null;

async function loadOrCreateKey() {
  const existing = await keyStore.getItem(KEY_ID);
  if (existing) return existing; // CryptoKey no exportable recuperado de IndexedDB

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // extractable = false → material de clave inaccesible desde JS
    ["encrypt", "decrypt"]
  );
  await keyStore.setItem(KEY_ID, key);
  return key;
}

// Cachea la promesa para no tocar IndexedDB en cada operación.
export function getKey() {
  if (!keyPromise) keyPromise = loadOrCreateKey();
  return keyPromise;
}

// Cifra un objeto JSON. Devuelve { iv, ct } (Uint8Array + ArrayBuffer), ambos
// clonables por structured clone y almacenables directamente en IndexedDB.
export async function encryptJSON(obj) {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // nonce de 96 bits
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { iv, ct };
}

// Descifra { iv, ct } y devuelve el objeto original. Si la autenticación GCM
// falla (datos manipulados), `decrypt` lanza y no se devuelve nada.
export async function decryptJSON(blob) {
  const key = await getKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.iv },
    key,
    blob.ct
  );
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// Borra la clave (p.ej. al cerrar sesión definitivamente). Sin la clave, los
// datos cifrados restantes son irrecuperables.
export async function destroyKey() {
  keyPromise = null;
  await keyStore.removeItem(KEY_ID);
}
