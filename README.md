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
- Demo save, loan request, repayment and withdrawal notices
- `GET /api/health`
- `POST /api/loan/quote`

## Important
This is only a visual/interaction preview. It does not provide secure customer accounts, persistent balances, real loan approvals, or live M-Pesa deposits/withdrawals. Do not use it to issue real loans or accept customer money. Before launching, implement secure authentication, a database-backed ledger, payment-provider integration and reconciliation, identity/security controls, and Kenyan legal/licensing/compliance review. The sample charge and repayment terms are illustrative and require proper review.

## ZetuPay payments (Railway)

Set these server-side Railway Variables before testing:

- `ZETUPAY_SECRET_KEY` — your ZetuPay wallet secret key. Never place it in `public/` or share it in chat.
- `ZETUPAY_WEBHOOK_SECRET` — the webhook secret configured for your ZetuPay callback. If your ZetuPay dashboard uses the API secret for callbacks, the server falls back to `ZETUPAY_SECRET_KEY`.
- `PUBLIC_APP_URL` — your public ZetuCash site origin, for example `https://your-app.up.railway.app` (no trailing slash).

Configure the ZetuPay **transaction callback URL** as `https://YOUR-PUBLIC-DOMAIN/webhooks/zetupay`. The webhook endpoint currently verifies the `x-zetupay-secret` header. Confirm the exact header name in your ZetuPay Developers dashboard/docs before accepting live payments.

Deposit checkout initiates a hosted ZetuPay payment; a deposit is credited only after a matching `payment.success` callback and amount/reference check. Duplicate successful callbacks do not credit the same deposit twice. Withdrawals reserve the requested wallet balance and submit a ZetuPay B2C payout; failed payout callbacks refund the reserved amount once. ZetuPay payouts may remain pending and require provider-side approval/balance.

**Important:** ZetuPay transactions use real money; do not test until the callback URL, secret, wallet balance, and provider response have been verified. Make a small test only when ready. The frontend uses simple amount prompts so the existing design remains unchanged.
