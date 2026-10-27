# LearnPath — Production Security, Firebase Authentication & Razorpay Integration

A modern, production-grade learning and career preparation platform featuring curated DSA sheets, 45+ company interview question banks, 20 essential coding patterns, role-wise roadmaps, and system design roadmaps.

---

## 1. Architecture Overview

- **Frontend**: React 19 SPA with Tailwind CSS v4, dark/light/auto appearance modes, and dynamic code splitting.
- **Backend API**: Full-stack Express application (`server.ts`) hosting secure authentication, Razorpay payments, and role-based administrative services, mounting Vite dev middlewares in development and serving static assets in production.
- **Database & Authentication**: Official Firebase SDK (Firestore Database & Firebase Authentication) backed by project `copper-circle-lds98`.
- **Payments**: Official Razorpay Checkout integration with server-side order calculation, HMAC-SHA256 signature verification, idempotent webhook processing, and refund controls.
- **Security**: Deny-by-default Firestore rules, in-memory rate limiting (10 req/min payments, 30 req/min auth), server-verified administrator allowlist, and zero client-side privilege trust.

---

## 2. Authentication & Administrator Authorization Model

### A. Sole Administrator Account
- **Authorized Administrator Email**: `vasivenkatavijay@gmail.com`
- **Server Enforcement**:
  - The browser is never trusted for user roles or administrative flags.
  - Every administrative request (`/api/admin/*`) must present a valid Firebase Bearer token verified against Google's public key infrastructure.
  - Privileges are granted if and only if:
    1. The token is cryptographically valid and unexpired.
    2. `email.toLowerCase() === 'vasivenkatavijay@gmail.com'` (or recognized allowlist).
    3. `email_verified === true`.
  - Unauthenticated requests return `401 Unauthorized`.
  - Non-admin authenticated accounts return `403 Forbidden` and trigger an automated entry in the security audit log.

### B. Standard Customer Accounts
- Normal users sign in via Google Authentication (`signInWithPopup(auth, googleProvider)`).
- Their user profiles and learning progress are stored under `/users/{uid}`.
- Firestore security rules strictly prevent users from modifying privileged fields (`role`, `isProUser`, `proPlan`, `proPaymentId`).

---

## 3. Razorpay Payment Lifecycle & Integration

### A. Server-Side Order Creation
- Route: `POST /api/payments/create-order`
- **Pricing Enforcement**: The order amount is calculated and enforced strictly on the server: **₹99.00 INR (9900 integer paise)**. Any client-provided price or discount is ignored.
- Generates an internal order record with status `PENDING`.
- Communicates with Razorpay Orders API (`POST https://api.razorpay.com/v1/orders`) using server-held credentials.

### B. Cryptographic Signature Verification
- Route: `POST /api/payments/verify`
- Upon checkout completion, the browser submits `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature`.
- The server generates the expected HMAC-SHA256 digest:
  ```ts
  const expectedSignature = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  ```
- Compares signatures using `crypto.timingSafeEqual` to prevent timing attacks.
- Only upon valid signature verification does the server update the internal order to `PAID` and grant the user lifetime Pro status.

### C. Webhook Processing & Reconciliation
- Route: `POST /api/payments/webhook`
- Validates the `x-razorpay-signature` header against the raw body using `RAZORPAY_WEBHOOK_SECRET`.
- Handles `payment.captured`, `order.paid`, and `payment.failed` idempotently.

---

## 4. Environment Variables Configuration

Copy `.env.example` to `.env` and configure your credentials:

```bash
# Server Network
PORT=3000
NODE_ENV=production

# Administrator Allowlist
ADMIN_EMAIL=made.by.vijayy@gmail.com

# Razorpay Credentials (from Razorpay Dashboard -> Settings -> API Keys)
RAZORPAY_KEY_ID=rzp_live_YOUR_KEY_ID_HERE
RAZORPAY_KEY_SECRET=YOUR_KEY_SECRET_HERE

# Razorpay Webhook Secret (from Razorpay Dashboard -> Settings -> Webhooks)
RAZORPAY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET_HERE

# Firebase Project Config (from firebase-applet-config.json)
VITE_FIREBASE_PROJECT_ID=copper-circle-lds98
VITE_FIREBASE_DATABASE_ID=ai-studio-08ed8d06-1a88-41fd-9a21-86f1b17bb938
```

---

## 5. Automated Security & Payment Test Suite

Run the full automated test suite covering RBAC, payment signatures, webhooks, and bundle security:

```bash
npm test
```

Test Results:
- **Authentication & RBAC**: Verified email allowlist, 401 unauthenticated, 403 non-admin rejection, client role tampering prevention.
- **Razorpay Cryptography**: Verified HMAC-SHA256 signature verification, timingSafeEqual checks, tampered signature rejection, server price enforcement.
- **Webhooks & Idempotency**: Verified raw payload HMAC signature checks and duplicate event deduplication.
- **Asset Hardening**: Verified zero exposed pilot passwords or secrets in production bundles.

---

## 6. Development & Deployment

```bash
# Run full-stack dev server (Express backend + Vite frontend)
npm run dev

# Run automated tests
npm test

# Type-check and lint
npm run lint

# Compile production build
npm run build

# Start production server
npm start
```
