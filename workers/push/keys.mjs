// Generate a VAPID key pair for the push worker:
//   node keys.mjs
// Store the private key as a worker secret and the public key as a GitHub
// repository variable (see the main README).
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const b64url = (b) => Buffer.from(b).toString('base64url');
console.log('Public key (GitHub variable VAPID_PUBLIC_KEY):\n' + b64url(raw) + '\n');
console.log('Private key (run: npx wrangler secret put VAPID_PRIVATE_JWK, then paste):\n' + JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d }));
