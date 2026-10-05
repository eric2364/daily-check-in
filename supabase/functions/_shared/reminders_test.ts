import webpush from 'npm:web-push@3.6.7';
import { createECDH, randomBytes } from 'node:crypto';
import { validSubscription, validTime, pushStatus } from './reminders.ts';

function assert(value: boolean, message: string) {
  if (!value) throw new Error(message);
}

const keys = { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) };
Deno.test('accepts browser push services but rejects arbitrary outbound destinations', () => {
  for (const endpoint of ['https://web.push.apple.com/token', 'https://fcm.googleapis.com/fcm/send/token', 'https://updates.push.services.mozilla.com/wpush/token', 'https://wns2.notify.windows.com/token']) {
    assert(validSubscription({ endpoint, keys }), endpoint);
  }
  for (const endpoint of ['https://localhost/token', 'http://web.push.apple.com/token', 'https://web.push.apple.com.evil.example/token', 'https://169.254.169.254/token', 'https://user:password@web.push.apple.com/token', 'https://fcm.googleapis.com:444/token']) {
    assert(!validSubscription({ endpoint, keys }), endpoint);
  }
  assert(!validSubscription(null), 'null');
  assert(!validSubscription({ endpoint: 'https://web.push.apple.com/token', keys: { p256dh: 'short', auth: keys.auth } }), 'short encryption key');
});

Deno.test('validates a full Hong Kong wall-clock minute', () => {
  for (const time of ['00:00', '09:00', '23:59']) assert(validTime(time), time);
  for (const time of ['24:00', '09:60', '9:00', '09:00:00', '', null, 900]) assert(!validTime(time), String(time));
});

Deno.test('extracts only a provider status rather than exposing push errors', () => {
  assert(pushStatus({ statusCode: 410, body: 'private provider response' }) === 410, 'expired');
  assert(pushStatus(new Error('network')) === undefined, 'network');
  assert(pushStatus(null) === undefined, 'missing');
});

Deno.test('web-push encrypts and signs a provider request under Deno Node compatibility', () => {
  const vapid = webpush.generateVAPIDKeys();
  const recipient = createECDH('prime256v1');
  recipient.generateKeys();
  const details = webpush.generateRequestDetails({
    endpoint: 'https://web.push.apple.com/test-token',
    keys: {
      p256dh: recipient.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  }, JSON.stringify({ title: 'Daily Check-in', body: 'Test' }), {
    TTL: 3600,
    vapidDetails: {
      subject: 'mailto:owner@example.com',
      publicKey: vapid.publicKey,
      privateKey: vapid.privateKey,
    },
  });
  assert(details.headers['Content-Encoding'] === 'aes128gcm', 'encrypted push encoding');
  assert(details.headers.Authorization.startsWith('vapid '), 'signed VAPID authorization');
  assert(details.body.length > 0, 'encrypted body');
  assert(!details.body.toString().includes('Daily Check-in'), 'payload is not cleartext');
});
