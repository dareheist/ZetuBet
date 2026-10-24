# ZetuBet

A mobile-friendly starter for a sports betting, casino-style and multiplier-game interface. This repository currently runs in **demo mode only**.

## Features in this starter

- Responsive dark theme for mobile and desktop
- Sample sports fixtures and illustrative odds
- Demo sports bet slip flow using simulated outcomes
- Three demo casino-style mini-games
- Simulated multiplier/crash game with manual and auto cash-out
- Browser-session activity history and virtual wallet
- Express server and `/api/health` endpoint

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Deploy

This is a Node.js web service. Set the build/install command to `npm install` and the start command to `npm start`. The service listens on `process.env.PORT` and binds to `0.0.0.0`.

## Important limitations

This is a UI prototype, not a production betting system. It does **not** implement real user authentication, a persistent wallet, real sports data, real-money deposits or withdrawals, or a production-grade betting engine. The demo balance and activity are held in browser memory and reset when the page reloads.

Do not connect real payments or accept real-money wagers with this starter. Before a real-money launch in Kenya, obtain the applicable gambling licence and legal advice, complete age/identity and responsible-gambling controls, and get written payment-provider approval for the specific betting use case. Production wallet balances and bet settlement must be handled server-side with a persistent database, audit logs, idempotent payment callbacks, and appropriate security review.

## Next development steps

1. Add secure registration/login (password hashing, sessions, rate limits, validation).
2. Add a database and immutable wallet ledger; never trust client-submitted balances.
3. Connect a licensed sports-data/odds provider and server-side bet settlement.
4. Design an auditable crash-game engine with server-generated round outcomes and verifiable logs.
5. Add admin roles, transaction review, age/identity checks and responsible-gambling controls.
6. Integrate M-PESA only after the provider has approved the licensed betting business model.
