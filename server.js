const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", app: "ZetuBet", mode: "demo" });
});

// Demo-only sample fixtures. These odds are illustrative, not live odds.
app.get("/api/sports", (_req, res) => {
  res.json([
    { id: "m1", league: "Premier League", home: "Arsenal", away: "Chelsea", kickoff: "Today · 18:00", homeOdds: 1.92, drawOdds: 3.40, awayOdds: 4.10 },
    { id: "m2", league: "Premier League", home: "Liverpool", away: "Tottenham", kickoff: "Today · 20:30", homeOdds: 1.75, drawOdds: 3.80, awayOdds: 4.55 },
    { id: "m3", league: "La Liga", home: "Real Madrid", away: "Barcelona", kickoff: "Tomorrow · 21:00", homeOdds: 2.15, drawOdds: 3.25, awayOdds: 2.90 }
  ]);
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ZetuBet demo running on port ${PORT}`);
});
