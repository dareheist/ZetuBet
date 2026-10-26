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
