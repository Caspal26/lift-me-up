// Local stand-ins for the browser push service and the WhatsApp Cloud API,
// used by the simulation. The push stand-in decrypts each message with the
// device's private key (RFC 8291, aes128gcm), so the simulation sees exactly
// what a phone would receive.
import crypto from 'node:crypto';
import http from 'node:http';

export function createDevice(name) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { name, ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

export function decryptPush(device, body) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const serverPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const prkKey = hmac(device.auth, device.ecdh.computeSecret(serverPublic));
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), device.ecdh.getPublicKey(), serverPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  return JSON.parse(plain.subarray(0, end).toString('utf8'));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function startMockServices({ now }) {
  const devices = new Map();
  const failures = new Map(); // device name -> number of upcoming requests to fail
  const pushes = [];
  const pushAttempts = [];
  const whatsapp = [];

  const server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const push = req.url.match(/^\/push\/([\w-]+)$/);
    if (req.method === 'POST' && push) {
      const device = devices.get(push[1]);
      const attempt = { device: push[1], at: now().toISOString(), topic: req.headers.topic, ttl: req.headers.ttl, urgency: req.headers.urgency };
      pushAttempts.push(attempt);
      if (!device) { res.writeHead(410).end(); return; }
      if ((failures.get(device.name) || 0) > 0) {
        failures.set(device.name, failures.get(device.name) - 1);
        attempt.result = 'failed (simulated 500)';
        res.writeHead(500).end('simulated push service error');
        return;
      }
      if (!/^vapid t=.+, k=.+/.test(req.headers.authorization || '') || req.headers['content-encoding'] !== 'aes128gcm') {
        attempt.result = 'rejected (bad headers)';
        res.writeHead(400).end('bad request');
        return;
      }
      const payload = decryptPush(device, body);
      attempt.result = 'delivered';
      pushes.push({ device: device.name, at: attempt.at, topic: attempt.topic, ttl: attempt.ttl, payload });
      res.writeHead(201).end();
      return;
    }
    const wa = req.url.match(/^\/v[\d.]+\/(\w+)\/messages$/);
    if (req.method === 'POST' && wa) {
      if (req.headers.authorization !== 'Bearer simulated-token') { res.writeHead(401).end(); return; }
      const json = JSON.parse(body.toString('utf8'));
      const id = `wamid.SIM${whatsapp.length + 1}`;
      whatsapp.push({ at: now().toISOString(), phoneNumberId: wa[1], body: json, id });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id }] }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    base,
    pushes,
    pushAttempts,
    whatsapp,
    addDevice(name) {
      const device = createDevice(name);
      devices.set(name, device);
      return { endpoint: `${base}/push/${name}`, keys: device.keys };
    },
    failNext(name, n = 1) {
      failures.set(name, n);
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
