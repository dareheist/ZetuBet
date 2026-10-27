# ZetuCash preview

This project replaces the old ZetuBet demo website with a mobile-friendly ZetuCash savings-based lending dashboard.

## Run locally
Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Included
- ZetuCash dashboard and mobile-friendly styling
- Savings Wallet and Loan Wallet preview
- Sample loan limit calculation: savings × 1.5
- Illustrative loan quote and repayment period
- ZetuPay hosted-checkout deposit initiation and signed transaction webhook
- ZetuPay M-Pesa payouts with balance reservation, failure refunds, and payout webhook
- Database-backed wallet transaction history
- `GET /api/health`
- `POST /api/loan/quote`

## Important
Payments require `DATABASE_URL`, a strong `JWT_SECRET` (at least 32 characters), and `ZETUPAY_SECRET_KEY` configured in Railway. Set `ZETUPAY_WEBHOOK_SECRET` to your wallet’s live `sk_live_...` key for webhook signature verification (it may be the same value as `ZETUPAY_SECRET_KEY` when that is already the live key). Set `PUBLIC_APP_URL` to the public ZetuCash HTTPS domain if it differs from the default. Register `https://YOUR-DOMAIN/webhooks/zetupay` as the Transaction Callback Endpoint and `https://YOUR-DOMAIN/webhooks/zetupay/payout` as the Payout Callback Endpoint in ZetuPay. Webhooks are verified using the timestamped HMAC signature and transaction changes are idempotent. ZetuPay documents no sandbox: even test keys can move real money, so test only with small payments to your own phone. Before launch, also complete provider reconciliation, support processes, and Kenyan legal/licensing/compliance review. Loan quotes remain illustrative and loan requests are not automatically approved or disbursed.
