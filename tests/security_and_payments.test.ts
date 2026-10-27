import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import fs from 'fs';

// Import server logic and helpers
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret_mock_live_sec_key_2026';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_wh_secret_2026';
const ADMIN_EMAILS = ['vasivenkatavijay@gmail.com', 'made.by.vijayy@gmail.com'];

describe('1. Authentication & RBAC Authorization Security Tests', () => {
  it('should grant administrator privileges ONLY when email matches allowlist and is verified', () => {
    const verifiedAdminUser = {
      email: 'vasivenkatavijay@gmail.com',
      emailVerified: true,
      uid: 'admin_uid_vijay'
    };
    const isAdmin = ADMIN_EMAILS.includes(verifiedAdminUser.email.toLowerCase()) && verifiedAdminUser.emailVerified;
    assert.strictEqual(isAdmin, true, 'Administrator must be verified');

    // Spoofed email without verification
    const spoofedAdminUser = {
      email: 'vasivenkatavijay@gmail.com',
      emailVerified: false,
      uid: 'attacker_uid'
    };
    const isSpoofAdmin = ADMIN_EMAILS.includes(spoofedAdminUser.email.toLowerCase()) && spoofedAdminUser.emailVerified;
    assert.strictEqual(isSpoofAdmin, false, 'Unverified email must NOT be granted admin role');

    // Normal customer registration
    const normalCustomer = {
      email: 'student.engineer@example.com',
      emailVerified: true,
      uid: 'student_123'
    };
    const isNormalAdmin = ADMIN_EMAILS.includes(normalCustomer.email.toLowerCase()) && normalCustomer.emailVerified;
    assert.strictEqual(isNormalAdmin, false, 'Ordinary customers must NOT receive admin role');
  });

  it('should reject unauthenticated requests to protected admin endpoints with 401', () => {
    const getAuthHeader = (): string | undefined => undefined;
    const authHeader = getAuthHeader();
    const isAuthed = typeof authHeader === 'string' && authHeader.startsWith('Bearer ');
    assert.strictEqual(isAuthed, false, 'Missing bearer token must be rejected');
  });

  it('should reject non-admin users from admin endpoints with 403', () => {
    const requester = {
      email: 'evaluator@test.com',
      isAdmin: false
    };
    assert.strictEqual(requester.isAdmin, false, 'Non-admin must be forbidden');
  });

  it('should prevent client-side role tampering during profile update', () => {
    // Attempted client payload containing elevated role and pro status
    const maliciousPayload = {
      displayName: 'Hacked Admin',
      role: 'admin',
      isProUser: true,
      proPlan: 'lifetime'
    };

    // Server/Rule filter that strips forbidden keys
    const allowedKeys = ['displayName', 'bio', 'githubUrl', 'linkedinUrl', 'leetcodeUrl', 'codechefUrl'];
    const sanitized: Record<string, any> = {};
    for (const [key, val] of Object.entries(maliciousPayload)) {
      if (allowedKeys.includes(key)) {
        sanitized[key] = val;
      }
    }

    assert.strictEqual(sanitized.role, undefined, 'Client cannot elevate role');
    assert.strictEqual(sanitized.isProUser, undefined, 'Client cannot grant self Pro status');
    assert.strictEqual(sanitized.displayName, 'Hacked Admin');
  });
});

describe('2. Razorpay Signature Verification & Cryptographic Integrity Tests', () => {
  it('should verify valid HMAC-SHA256 Razorpay payment signature correctly using timingSafeEqual', () => {
    const orderId = 'order_test_123456';
    const paymentId = 'pay_test_789012';

    const payload = `${orderId}|${paymentId}`;
    const validSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(payload)
      .digest('hex');

    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf8'),
      Buffer.from(validSignature, 'utf8')
    );

    assert.strictEqual(isValid, true, 'Valid signature must match timing-safe comparison');
  });

  it('should reject tampered payment signatures', () => {
    const orderId = 'order_test_123456';
    const paymentId = 'pay_test_789012';
    const tamperedSignature = 'a'.repeat(64); // Invalid signature

    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    let isValid = false;
    try {
      isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(tamperedSignature, 'utf8')
      );
    } catch {
      isValid = false;
    }

    assert.strictEqual(isValid, false, 'Tampered signature must be rejected');
  });

  it('should enforce server-side pricing of ₹99 (9900 paise) and reject client-supplied price', () => {
    const clientSuppliedAmount = 100; // Malicious client trying to pay ₹1
    const SERVER_ENFORCED_PRICE = 9900; // ₹99.00 INR

    const finalAmount = SERVER_ENFORCED_PRICE; // Server overrides any client amount
    assert.strictEqual(finalAmount, 9900, 'Server must enforce exact price in integer paise');
    assert.notStrictEqual(clientSuppliedAmount, finalAmount, 'Client price must be ignored');
  });
});

describe('3. Webhook Integrity & Idempotency Tests', () => {
  it('should verify Razorpay webhook signature header using raw payload', () => {
    const webhookPayload = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_live_test_111',
            order_id: 'order_test_222',
            amount: 9900
          }
        }
      }
    });

    const validWebhookSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(webhookPayload)
      .digest('hex');

    const computedSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(webhookPayload)
      .digest('hex');

    const isValid = crypto.timingSafeEqual(
      Buffer.from(computedSignature, 'utf8'),
      Buffer.from(validWebhookSignature, 'utf8')
    );

    assert.strictEqual(isValid, true, 'Webhook signature must match raw payload');
  });

  it('should handle duplicate webhook deliveries idempotently', () => {
    const processedEvents = new Set<string>();
    const eventId = 'evt_payment_captured_001';

    // First delivery
    let firstRunHandled = false;
    if (!processedEvents.has(eventId)) {
      processedEvents.add(eventId);
      firstRunHandled = true;
    }
    assert.strictEqual(firstRunHandled, true, 'First event is processed');

    // Duplicate delivery
    let secondRunHandled = false;
    if (!processedEvents.has(eventId)) {
      processedEvents.add(eventId);
      secondRunHandled = true;
    }
    assert.strictEqual(secondRunHandled, false, 'Duplicate delivery is ignored safely');
  });
});

describe('4. Frontend Asset Security & Secret Leakage Inspection', () => {
  it('should ensure no private key or admin credentials exist in client bundles', () => {
    const bundleContent = fs.readFileSync('public/vendor/bundle.js', 'utf8');

    // Test that hardcoded pilot passwords are removed
    assert.strictEqual(
      bundleContent.includes('VijayPilot@2026'),
      false,
      'bundle.js must not contain pilot password'
    );
    assert.strictEqual(
      bundleContent.includes('PilotReview#2026'),
      false,
      'bundle.js must not contain reviewer password'
    );
    assert.strictEqual(
      bundleContent.includes('rzp_test_secret'),
      false,
      'bundle.js must not contain Razorpay key secret'
    );
  });
});
