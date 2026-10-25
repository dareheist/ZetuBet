const $ = (id) => document.getElementById(id);
const state = { balance: 1000, plays: 0, net: 0, history: [], crash: null, crashTimer: null, crashValue: 1, crashPoint: 1.5, crashStake: 0, cashed: false, cashoutValue: 0 };
const money = (n) => "$" + Number(n).toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2});
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}
function renderBalance() {
  ["balanceSide","balanceMain","crashBalance"].forEach(id => { if ($(id)) $(id).textContent = money(state.balance); });
  $("playCount").textContent = state.plays;
  $("netResult").textContent = money(state.net);
  $("netResult").className = state.net >= 0 ? "positive" : "negative";
}
function record(title, result, amount) {
  state.history.unshift({title, result, amount, time: new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})});
  renderHistory();
}
function renderHistory() {
  const root = $("historyRows");
  if (!state.history.length) { root.innerHTML = '<p class="empty-state">Your demo activity will appear here.</p>'; return; }
  root.innerHTML = state.history.map(item => `<div class="history-row"><span>${escapeHtml(item.title)}</span><strong class="${item.amount >= 0 ? "positive" : "negative"}">${escapeHtml(item.result)} ${item.amount >= 0 ? "+" : ""}${money(item.amount)}</strong><span>${escapeHtml(item.time)}</span></div>`).join("");
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
async function loadMatches() {
  try {
    const response = await fetch("/api/sports");
    const matches = await response.json();
    $("matches").innerHTML = matches.map(m => `<article class="match-card"><div class="match-meta"><span>${escapeHtml(m.league)}</span><span>${escapeHtml(m.kickoff)}</span></div><div class="match-teams"><span>${escapeHtml(m.home)}</span><span class="versus">VS</span><span class="away">${escapeHtml(m.away)}</span></div><div class="odds-row">${oddButton(m,"home",m.homeOdds,"1")}${oddButton(m,"draw",m.drawOdds,"X")}${oddButton(m,"away",m.awayOdds,"2")}</div></article>`).join("");
    document.querySelectorAll("[data-bet]").forEach(btn => btn.addEventListener("click", () => placeDemoBet(btn.dataset.match, btn.dataset.selection, Number(btn.dataset.odds))));
  } catch { $("matches").innerHTML = '<p class="empty-state">Could not load sample matches. Please refresh.</p>'; }
}
function oddButton(m, selection, odds, label) {
  return `<button class="odd-btn" data-bet="1" data-match="${escapeHtml(m.home+" vs "+m.away)}" data-selection="${label}" data-odds="${odds}">${label}<span>${Number(odds).toFixed(2)}</span></button>`;
}
function placeDemoBet(match, selection, odds) {
  const stakeRaw = prompt(`Demo stake for ${match} (${selection})\nPotential return at sample odds ${odds.toFixed(2)}. Enter stake ($1–$100):`, "10");
  if (stakeRaw === null) return;
  const stake = Number(stakeRaw);
  if (!Number.isFinite(stake) || stake < 1 || stake > 100 || stake > state.balance) { toast("Enter a valid demo stake within your balance."); return; }
  state.balance -= stake;
  // A deliberately simple simulated result for UI testing; not a real sporting outcome.
  const won = Math.random() < 0.48;
  const payout = won ? stake * odds : 0;
  state.balance += payout;
  const net = payout - stake;
  state.net += net; state.plays++;
  record(`Sports · ${match} (${selection})`, won ? "DEMO WIN" : "DEMO LOSS", net);
  renderBalance();
  toast(won ? `Demo win! Returned ${money(payout)}.` : "Demo loss. No real money was involved.");
}
function playCasino(type) {
  const stake = 10;
  if (state.balance < stake) { toast("Not enough demo funds. Add demo funds first."); return; }
  state.balance -= stake;
  let won = false, multiplier = 0, label = "";
  if (type === "wheel") { multiplier = [0,0,0,1.5,2,3,5][Math.floor(Math.random()*7)]; label = "Lucky Wheel"; }
  else if (type === "slots") { const r = Math.random(); multiplier = r < .08 ? 5 : r < .28 ? 1.5 : 0; label = "Triple Spark"; }
  else { multiplier = Math.random() < .46 ? 1.9 : 0; label = "High Card"; }
  won = multiplier > 0;
  const payout = stake * multiplier;
  state.balance += payout; state.net += payout - stake; state.plays++;
  record(`Casino · ${label}`, won ? "DEMO WIN" : "DEMO LOSS", payout - stake);
  renderBalance();
  toast(won ? `${label}: demo return ${money(payout)}.` : `${label}: no demo return this time.`);
}
function showPage(page) {
  ["sports","casino","aviator","history","account"].forEach(p => $(p+"Page").classList.toggle("hidden", p !== page));
  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  $("sidebar").classList.remove("open"); $("scrim").classList.remove("show");
  window.scrollTo({top:0,behavior:"smooth"});
}
function openModal(kind) {
  $("modalTitle").textContent = kind === "login" ? "Welcome back" : "Join ZetuBet";
  $("modalDescription").textContent = "Secure registration and login are not connected in this demo starter. The next build step can add a backend, password hashing and account sessions.";
  $("modalBackdrop").classList.remove("hidden");
}
function finishCrash(cashedOut) {
  if (!state.crash) return;
  clearInterval(state.crashTimer); state.crashTimer = null;
  const finalValue = state.crashValue;
  if (cashedOut) {
    const payout = state.crashStake * state.cashoutValue;
    state.balance += payout; state.net += payout - state.crashStake;
    $("crashStatus").textContent = `Cashed out at ${state.cashoutValue.toFixed(2)}× · demo return ${money(payout)}`;
    record(`Crash · ${state.cashoutValue.toFixed(2)}×`, "DEMO CASH-OUT", payout - state.crashStake);
    toast(`Demo cash-out: ${money(payout)}.`);
  } else {
    state.net -= state.crashStake;
    $("crashStatus").textContent = `Crashed at ${finalValue.toFixed(2)}× · demo stake lost`;
    record(`Crash · ${finalValue.toFixed(2)}×`, "DEMO CRASH", -state.crashStake);
    toast("The demo round crashed.");
  }
  state.plays++; state.crash = null; $("startCrash").disabled = false; $("cashout").disabled = true;
  $("multiplier").textContent = finalValue.toFixed(2) + "×"; renderBalance();
}
$("startCrash").addEventListener("click", () => {
  if (state.crash) return;
  const stake = Number($("crashStake").value), auto = Number($("autoCashout").value);
  if (!Number.isFinite(stake) || stake < 1 || stake > 500 || stake > state.balance) { toast("Enter a valid demo stake within your balance."); return; }
  if ($("autoCashout").value && (!Number.isFinite(auto) || auto < 1.1 || auto > 100)) { toast("Auto cash-out must be between 1.1× and 100×."); return; }
  state.balance -= stake; state.crashStake = stake; state.crashValue = 1; state.cashed = false; state.cashoutValue = 0;
  // Random crash point is only a front-end demonstration, not a production gambling engine.
  state.crashPoint = Math.max(1.01, Math.min(12, 1 + (-Math.log(Math.max(.0001, Math.random())) * 1.45)));
  state.crash = true; $("startCrash").disabled = true; $("cashout").disabled = false;
  $("crashStatus").textContent = "Flying… cash out before the crash"; renderBalance();
  state.crashTimer = setInterval(() => {
    state.crashValue = 1 + ((Date.now() - state.crashStarted) / 1000) ** 1.25 * .24;
    $("multiplier").textContent = state.crashValue.toFixed(2) + "×";
    if (auto && state.crashValue >= auto) { state.cashoutValue = auto; finishCrash(true); }
    else if (state.crashValue >= state.crashPoint) finishCrash(false);
  }, 80);
  state.crashStarted = Date.now();
});
$("cashout").addEventListener("click", () => { if (!state.crash) return; state.cashoutValue = state.crashValue; finishCrash(true); });
$("addDemoBtn").addEventListener("click", () => { state.balance += 500; renderBalance(); toast("$500 demo funds added. No real deposit was made."); });
document.querySelectorAll(".nav-item").forEach(b => b.addEventListener("click", () => showPage(b.dataset.page)));
document.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => showPage(b.dataset.go)));
document.querySelectorAll("[data-casino]").forEach(b => b.addEventListener("click", () => playCasino(b.dataset.casino)));
$("menuToggle").addEventListener("click", () => { $("sidebar").classList.toggle("open"); $("scrim").classList.toggle("show"); });
$("scrim").addEventListener("click", () => { $("sidebar").classList.remove("open"); $("scrim").classList.remove("show"); });
$("loginBtn").addEventListener("click", () => openModal("login"));
$("signupBtn").addEventListener("click", () => openModal("signup"));
$("modalClose").addEventListener("click", () => $("modalBackdrop").classList.add("hidden"));
$("modalOk").addEventListener("click", () => $("modalBackdrop").classList.add("hidden"));
$("modalBackdrop").addEventListener("click", e => { if (e.target === $("modalBackdrop")) $("modalBackdrop").classList.add("hidden"); });
renderBalance(); loadMatches();
