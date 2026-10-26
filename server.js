const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "ZetuCash", mode: "demo-preview" });
});

app.post("/api/loan/quote", (req, res) => {
  const savings = Number(req.body && req.body.savings);
  const principal = Number(req.body && req.body.principal);
  if (!Number.isFinite(savings) || savings < 0 || !Number.isFinite(principal) || principal <= 0) {
    return res.status(400).json({ error: "Enter valid savings and loan amount." });
  }
  const limit = Math.floor(savings * 1.5);
  if (principal > limit) {
    return res.status(400).json({ error: `Your current loan limit is KSh ${limit}.`, limit });
  }
  const charge = Math.round(principal * (20 / 150));
  const days = principal <= 500 ? 14 : principal <= 1500 ? 21 : principal <= 5000 ? 30 : principal <= 10000 ? 45 : 60;
  res.json({ limit, principal, charge, total: principal + charge, days, approved: false,
    message: "Indicative quote only. No loan is approved and no money is moved." });
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, "0.0.0.0", () => console.log(`ZetuCash preview running on port ${PORT}`));
