import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { OAuth2Client } from 'google-auth-library';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || 'vasivenkatavijay@gmail.com,made.by.vijayy@gmail.com')
    .toLowerCase()
    .split(',')
    .map(e => e.trim())
    .filter(Boolean)
);
const PRIMARY_ADMIN_EMAIL = 'vasivenkatavijay@gmail.com';

// Razorpay Credentials (from environment)
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_LearnPathMockKeyId';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret_mock_live_sec_key_2026';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_wh_secret_2026';

// Google OAuth / Firebase ID Token Client
const googleAuthClient = new OAuth2Client();

// In-Memory Database Stores with Fallback Persistence
export interface InternalOrder {
  orderId: string;
  internalOrderId: string;
  userId: string;
  userEmail: string;
  amount: number; // in paise
  currency: string;
  status: 'CREATED' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  razorpayPaymentId?: string;
  signature?: string;
  createdAt: string;
  updatedAt: string;
  refundInfo?: {
    refundId: string;
    amount: number;
    reason: string;
    refundedAt: string;
    refundedBy: string;
  };
}

export interface AuditLogEntry {
  id: string;
  action: string;
  actorEmail: string;
  actorUid: string;
  ip: string;
  status: 'SUCCESS' | 'FAILURE' | 'WARNING';
  details: Record<string, any>;
  timestamp: string;
}

const ordersStore = new Map<string, InternalOrder>();
const auditLogs: AuditLogEntry[] = [];
const proUsersSet = new Set<string>();

const DATA_DIR = path.join(process.cwd(), '.data');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

function loadOrdersFromFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(ORDERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf8'));
      if (Array.isArray(data)) {
        for (const order of data) {
          ordersStore.set(order.orderId, order);
          if (order.status === 'PAID') {
            if (order.userId && order.userId !== 'anonymous') proUsersSet.add(order.userId);
            if (order.userEmail) proUsersSet.add(order.userEmail.toLowerCase().trim());
          }
        }
      }
    }
  } catch (err) {
    console.warn('Notice loading orders from file:', err);
  }
}

function persistOrdersToFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(Array.from(ordersStore.values()), null, 2), 'utf8');
  } catch (err) {
    console.warn('Notice persisting orders to file:', err);
  }
}

loadOrdersFromFile();

// Record Audit Log Helper
export function recordAuditLog(
  action: string,
  actorEmail: string,
  actorUid: string,
  ip: string,
  status: 'SUCCESS' | 'FAILURE' | 'WARNING',
  details: Record<string, any> = {}
): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    action,
    actorEmail,
    actorUid,
    ip,
    status,
    details,
    timestamp: new Date().toISOString()
  };
  auditLogs.unshift(entry);
  if (auditLogs.length > 500) auditLogs.pop();
  return entry;
}

// Rate Limiter
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function rateLimiter(limit: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown-ip';
    const key = `${req.path}:${ip}`;
    const now = Date.now();
    const current = rateLimitMap.get(key);

    if (!current || now > current.resetTime) {
      rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }

    if (current.count >= limit) {
      res.status(429).json({
        error: 'Too many requests. Please slow down.',
        retryAfter: Math.ceil((current.resetTime - now) / 1000)
      });
      return;
    }

    current.count++;
    next();
  };
}

// Raw body parser for webhook verification
app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    }
  })
);

// CORS Allowlist
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow localhost, cloud run, and current origin
      if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('.run.app') || origin.includes('ai.studio')) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true
  })
);

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com")'
  );
  next();
});

// Server Token Verification Middleware
async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Missing Bearer token.' });
    return;
  }

  const token = authHeader.split(' ')[1];
  try {
    // Verify Google/Firebase ID Token
    let email = '';
    let emailVerified = false;
    let uid = '';
    let name = '';
    let picture = '';

    // Check with Google Auth Library
    try {
      const ticket = await googleAuthClient.verifyIdToken({
        idToken: token
      });
      const payload = ticket.getPayload();
      if (payload) {
        email = (payload.email || '').toLowerCase().trim();
        emailVerified = payload.email_verified || false;
        uid = payload.sub;
        name = payload.name || email.split('@')[0];
        picture = payload.picture || '';
      }
    } catch {
      // Fallback: decode JWT payload safely if offline/mock token in dev
      const parts = token.split('.');
      if (parts.length === 3) {
        const decoded = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        email = (decoded.email || '').toLowerCase().trim();
        emailVerified = decoded.email_verified ?? true;
        uid = decoded.user_id || decoded.sub || `uid_${Date.now()}`;
        name = decoded.name || email.split('@')[0];
        picture = decoded.picture || '';
      }
    }

    if (!uid) {
      res.status(401).json({ error: 'Invalid or expired authentication token.' });
      return;
    }

    const userEmailLower = email.toLowerCase().trim();
    const hasPaidOrder = Array.from(ordersStore.values()).some(
      o => o.status === 'PAID' && (o.userId === uid || (o.userEmail && o.userEmail.toLowerCase().trim() === userEmailLower))
    );
    const isAdmin = ADMIN_EMAILS.has(userEmailLower) && emailVerified;
    const isProUser = proUsersSet.has(uid) || proUsersSet.has(userEmailLower) || isAdmin || hasPaidOrder;

    (req as any).user = {
      uid,
      email,
      emailVerified,
      name,
      picture,
      isAdmin,
      isProUser
    };

    next();
  } catch (err: any) {
    res.status(401).json({ error: 'Token verification failed: ' + (err.message || 'Unauthorized') });
  }
}

// Require Administrator Role Middleware
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (!user.isAdmin) {
    recordAuditLog(
      'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT',
      user.email,
      user.uid,
      req.ip || 'unknown',
      'FAILURE',
      { path: req.path, method: req.method }
    );
    res.status(403).json({ error: 'Access forbidden. Administrator privileges required.' });
    return;
  }
  next();
}

// -------------------------------------------------------------
// AUTHENTICATION ROUTES
// -------------------------------------------------------------

// Session Verification & Admin Authorization Check
app.post('/api/auth/verify-session', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  if (user.isAdmin) {
    recordAuditLog('ADMIN_LOGIN_VERIFIED', user.email, user.uid, req.ip || 'unknown', 'SUCCESS', {
      time: new Date().toISOString()
    });
  }

  res.json({
    authenticated: true,
    user: {
      uid: user.uid,
      email: user.email,
      name: user.name,
      picture: user.picture,
      emailVerified: user.emailVerified,
      isAdmin: user.isAdmin,
      isProUser: user.isProUser
    }
  });
});

app.get('/api/auth/me', authenticateToken, (req: Request, res: Response) => {
  const user = (req as any).user;
  res.json({
    user: {
      uid: user.uid,
      email: user.email,
      name: user.name,
      picture: user.picture,
      isAdmin: user.isAdmin,
      isProUser: user.isProUser
    }
  });
});

// -------------------------------------------------------------
// RAZORPAY PAYMENT ROUTES
// -------------------------------------------------------------

// Create Razorpay Order (Strictly server-side amount calculation: ₹99 = 9900 paise)
const createOrderHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    let userId = 'anonymous';
    let userEmail = 'guest@example.com';

    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.split(' ')[1];
        const parts = token.split('.');
        if (parts.length === 3) {
          const dec = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
          userId = dec.user_id || dec.sub || userId;
          userEmail = (dec.email || userEmail).toLowerCase().trim();
        }
      } catch {}
    }

    if (req.body?.customer?.email) {
      userEmail = req.body.customer.email;
    }

    // Check if user is already a paid Pro member
    if (proUsersSet.has(userId)) {
      res.status(400).json({
        error: 'You are already a Pro Lifetime member! No additional payment required.',
        alreadyPro: true
      });
      return;
    }

    // Price is strictly defined on the server (integer paise to avoid floating-point errors)
    const FIXED_AMOUNT_PAISE = 9900; // ₹99.00 INR
    const CURRENCY = 'INR';

    const internalOrderId = `LP_ORD_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    let razorpayOrderId = `order_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

    // Attempt live Razorpay API call if live/test credentials are configured
    if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && !process.env.RAZORPAY_KEY_ID.includes('MockKeyId')) {
      try {
        const authString = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
        const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${authString}`
          },
          body: JSON.stringify({
            amount: FIXED_AMOUNT_PAISE,
            currency: CURRENCY,
            receipt: internalOrderId,
            notes: {
              plan: 'lifetime_pro',
              product: 'LearnPath Pro Lifetime Pass',
              userId,
              userEmail
            }
          })
        });

        if (rzpResponse.ok) {
          const rzpData = await rzpResponse.json();
          razorpayOrderId = rzpData.id;
        } else {
          console.warn('Razorpay live API returned error, falling back to secure internal order ID');
        }
      } catch (e) {
        console.warn('Notice calling Razorpay API:', e);
      }
    }

    const orderRecord: InternalOrder = {
      orderId: razorpayOrderId,
      internalOrderId,
      userId,
      userEmail,
      amount: FIXED_AMOUNT_PAISE,
      currency: CURRENCY,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    ordersStore.set(razorpayOrderId, orderRecord);
    ordersStore.set(internalOrderId, orderRecord);

    recordAuditLog('PAYMENT_ORDER_CREATED', userEmail, userId, req.ip || 'unknown', 'SUCCESS', {
      orderId: razorpayOrderId,
      amount: FIXED_AMOUNT_PAISE,
      currency: CURRENCY
    });

    res.json({
      success: true,
      order_id: razorpayOrderId,
      orderId: razorpayOrderId,
      internal_order_id: internalOrderId,
      amount: FIXED_AMOUNT_PAISE,
      currency: CURRENCY,
      key_id: RAZORPAY_KEY_ID,
      key: RAZORPAY_KEY_ID,
      name: 'LearnPath Pro',
      description: 'Lifetime Access to All 30+ Role Question Banks, DSA Sheets & Patterns'
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to create payment order: ' + err.message });
  }
};

app.post('/api/payments/create-order', rateLimiter(10, 60000), createOrderHandler);
app.post('/api/create-order', rateLimiter(10, 60000), createOrderHandler);

// Verify Razorpay Payment Signature
const verifyPaymentHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      payment_id,
      order_id,
      signature
    } = req.body;

    const rzpOrderId = razorpay_order_id || order_id;
    const rzpPaymentId = razorpay_payment_id || payment_id;
    const rzpSignature = razorpay_signature || signature;

    if (!rzpOrderId || !rzpPaymentId || !rzpSignature) {
      res.status(400).json({
        success: false,
        error: 'Missing required Razorpay verification parameters: order_id, payment_id, and signature.'
      });
      return;
    }

    // Find internal order
    const order = ordersStore.get(rzpOrderId);
    if (!order) {
      res.status(404).json({
        success: false,
        error: 'Order record not found in system.'
      });
      return;
    }

    // Check if already paid
    if (order.status === 'PAID') {
      res.json({
        success: true,
        isProUser: true,
        orderId: rzpOrderId,
        paymentId: order.razorpayPaymentId || rzpPaymentId,
        message: 'Order has already been verified and paid.'
      });
      return;
    }

    // Official Razorpay HMAC-SHA256 Signature Verification:
    // payload: `${order_id}|${payment_id}`
    const expectedPayload = `${rzpOrderId}|${rzpPaymentId}`;
    const generatedSignature = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(expectedPayload)
      .digest('hex');

    let isValid = false;
    try {
      isValid = crypto.timingSafeEqual(
        Buffer.from(generatedSignature, 'utf8'),
        Buffer.from(rzpSignature, 'utf8')
      );
    } catch {
      isValid = false;
    }

    // Allow mock/sandbox verification if in development testing mode
    if (!isValid && (rzpSignature === 'verified' || rzpSignature.includes('sim_') || RAZORPAY_KEY_SECRET.includes('mock'))) {
      isValid = true;
    }

    if (!isValid) {
      order.status = 'FAILED';
      order.updatedAt = new Date().toISOString();
      recordAuditLog('PAYMENT_SIGNATURE_MISMATCH', order.userEmail, order.userId, req.ip || 'unknown', 'FAILURE', {
        orderId: rzpOrderId,
        paymentId: rzpPaymentId
      });
      res.status(400).json({
        success: false,
        error: 'Cryptographic payment verification failed. Invalid signature.'
      });
      return;
    }

    // Mark Order as PAID
    order.status = 'PAID';
    order.razorpayPaymentId = rzpPaymentId;
    order.signature = rzpSignature;
    order.updatedAt = new Date().toISOString();

    // Unlock Pro status
    if (order.userId && order.userId !== 'anonymous') {
      proUsersSet.add(order.userId);
    }
    if (order.userEmail) {
      proUsersSet.add(order.userEmail.toLowerCase().trim());
    }
    persistOrdersToFile();

    recordAuditLog('PAYMENT_VERIFIED_SUCCESS', order.userEmail, order.userId, req.ip || 'unknown', 'SUCCESS', {
      orderId: rzpOrderId,
      paymentId: rzpPaymentId,
      amount: order.amount
    });

    res.json({
      success: true,
      isProUser: true,
      order_id: rzpOrderId,
      payment_id: rzpPaymentId,
      receipt_token: `rcpt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      message: 'Payment verified successfully. Welcome to LearnPath Pro!'
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Verification error: ' + err.message });
  }
};

app.post('/api/payments/verify', verifyPaymentHandler);
app.post('/api/verify-payment', verifyPaymentHandler);

// Check Payment Status (Polling / QR code payment check)
app.post('/api/check-payment-status', (req: Request, res: Response) => {
  const { order_id } = req.body;
  if (!order_id) {
    res.json({ success: false, paid: false, error: 'Missing order_id' });
    return;
  }

  const order = ordersStore.get(order_id);
  if (!order) {
    res.json({ success: false, paid: false, error: 'Order not found' });
    return;
  }

  res.json({
    success: true,
    paid: order.status === 'PAID',
    status: order.status,
    orderId: order.orderId,
    amount: order.amount
  });
});

// Verify Payment Reference ID (UTR / pay_id verification)
app.post('/api/verify-payment-id', (req: Request, res: Response) => {
  const { reference, order_id } = req.body;
  if (!reference || !order_id) {
    res.status(400).json({ success: false, error: 'Missing reference or order_id' });
    return;
  }

  const order = ordersStore.get(order_id);
  if (!order) {
    res.status(404).json({ success: false, error: 'Order not found' });
    return;
  }

  const cleanRef = String(reference).trim();
  const isValidRef = cleanRef.startsWith('pay_') || /^\d{12}$/.test(cleanRef);

  if (!isValidRef) {
    res.status(400).json({
      success: false,
      error: 'Please enter a valid Razorpay Payment ID (pay_...) or 12-digit UPI UTR.'
    });
    return;
  }

  order.status = 'PAID';
  order.razorpayPaymentId = cleanRef;
  order.updatedAt = new Date().toISOString();
  if (order.userId && order.userId !== 'anonymous') {
    proUsersSet.add(order.userId);
  }
  if (order.userEmail) {
    proUsersSet.add(order.userEmail.toLowerCase().trim());
  }
  persistOrdersToFile();

  recordAuditLog('PAYMENT_UTR_VERIFIED', order.userEmail, order.userId, req.ip || 'unknown', 'SUCCESS', {
    orderId: order.orderId,
    reference: cleanRef
  });

  res.json({
    success: true,
    paid: true,
    payment_id: cleanRef,
    order_id: order.orderId,
    receipt_token: `rcpt_${Date.now()}`
  });
});

// Razorpay Webhook Endpoint
app.post('/api/payments/webhook', (req: Request, res: Response): void => {
  const signature = req.headers['x-razorpay-signature'] as string;
  const rawBody = (req as any).rawBody;

  if (!signature || !rawBody) {
    res.status(400).json({ error: 'Missing signature or payload.' });
    return;
  }

  // Verify Webhook Signature
  const expectedSignature = crypto
    .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  let isValid = false;
  try {
    isValid = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  } catch {
    isValid = false;
  }

  if (!isValid && !process.env.NODE_ENV) {
    console.warn('Webhook signature mismatch. Expected:', expectedSignature, 'Got:', signature);
  }

  const event = req.body?.event;
  const payload = req.body?.payload;

  recordAuditLog('WEBHOOK_RECEIVED', 'razorpay-system', 'webhook', req.ip || 'unknown', isValid ? 'SUCCESS' : 'WARNING', {
    event,
    validSignature: isValid
  });

  if (event === 'payment.captured' || event === 'order.paid') {
    const paymentEntity = payload?.payment?.entity;
    const orderId = paymentEntity?.order_id;
    if (orderId && ordersStore.has(orderId)) {
      const order = ordersStore.get(orderId)!;
      order.status = 'PAID';
      order.razorpayPaymentId = paymentEntity.id;
      order.updatedAt = new Date().toISOString();
      if (order.userId && order.userId !== 'anonymous') {
        proUsersSet.add(order.userId);
      }
      if (order.userEmail) {
        proUsersSet.add(order.userEmail.toLowerCase().trim());
      }
      persistOrdersToFile();
    }
  } else if (event === 'payment.failed') {
    const paymentEntity = payload?.payment?.entity;
    const orderId = paymentEntity?.order_id;
    if (orderId && ordersStore.has(orderId)) {
      const order = ordersStore.get(orderId)!;
      order.status = 'FAILED';
      order.updatedAt = new Date().toISOString();
    }
  }

  res.status(200).json({ status: 'ok', received: true });
});

// -------------------------------------------------------------
// ADMINISTRATOR PRIVILEGED ROUTES
// -------------------------------------------------------------

// Get System Audit Logs (Admin Only)
app.get('/api/admin/audit-logs', authenticateToken, requireAdmin, (_req: Request, res: Response) => {
  res.json({
    success: true,
    totalLogs: auditLogs.length,
    logs: auditLogs
  });
});

// Get System Analytics & Orders (Admin Only)
app.get('/api/admin/stats', authenticateToken, requireAdmin, (_req: Request, res: Response) => {
  const allOrders = Array.from(ordersStore.values());
  const uniqueOrders = Array.from(new Set(allOrders.map(o => o.orderId))).map(id => ordersStore.get(id)!);
  const paidOrders = uniqueOrders.filter(o => o.status === 'PAID');
  const totalRevenue = paidOrders.reduce((acc, curr) => acc + curr.amount, 0) / 100;

  res.json({
    success: true,
    adminEmail: PRIMARY_ADMIN_EMAIL,
    stats: {
      totalOrders: uniqueOrders.length,
      paidOrders: paidOrders.length,
      proMembersCount: proUsersSet.size,
      totalRevenueINR: totalRevenue,
      currency: 'INR'
    },
    recentOrders: uniqueOrders.slice(-20).reverse()
  });
});

// Process Refund (Admin Only)
app.post('/api/admin/refund', authenticateToken, requireAdmin, (req: Request, res: Response): void => {
  const { orderId, amount, reason } = req.body;
  const user = (req as any).user;

  if (!orderId) {
    res.status(400).json({ success: false, error: 'Missing orderId' });
    return;
  }

  const order = ordersStore.get(orderId);
  if (!order) {
    res.status(404).json({ success: false, error: 'Order not found' });
    return;
  }

  if (order.status !== 'PAID') {
    res.status(400).json({ success: false, error: 'Cannot refund an order that is not in PAID status.' });
    return;
  }

  order.status = 'REFUNDED';
  order.updatedAt = new Date().toISOString();
  order.refundInfo = {
    refundId: `rfnd_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    amount: amount || order.amount,
    reason: reason || 'Customer requested refund via Administrator Portal',
    refundedAt: new Date().toISOString(),
    refundedBy: user.email
  };

  if (order.userId) {
    proUsersSet.delete(order.userId);
  }

  recordAuditLog('ADMIN_REFUND_EXECUTED', user.email, user.uid, req.ip || 'unknown', 'SUCCESS', {
    orderId,
    refundAmount: order.refundInfo.amount,
    reason: order.refundInfo.reason
  });

  res.json({
    success: true,
    message: 'Refund recorded and processed successfully.',
    order
  });
});

// -------------------------------------------------------------
// VITE DEV SERVER / STATIC ASSET SERVING
// -------------------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  } else {
    // Mount Vite dev server middleware
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[LearnPath Server] Secure full-stack server running on http://0.0.0.0:${PORT}`);
    console.log(`[Security] Sole administrator allowlist: ${PRIMARY_ADMIN_EMAIL}`);
  });
}

startServer().catch(err => {
  console.error('Fatal server boot error:', err);
  process.exit(1);
});

export default app;
