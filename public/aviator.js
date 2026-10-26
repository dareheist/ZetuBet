const $ = id => document.getElementById(id);

let balance = 10000;
let phase = "waiting";
let multiplier = 1;
let round = 0;

const players = [
  { input: "stake-one", bet: "bet-one", cash: "cashout-one", result: "return-one", msg: "message-one", stake: 0, active: false },
  { input: "stake-two", bet: "bet-two", cash: "cashout-two", result: "return-two", msg: "message-two", stake: 0, active: false }
];

function sound(freq, duration = 0.15) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.04, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
    osc.onended = () => ctx.close();
  } catch {}
}

function update() {
  $("aviator-balance").textContent = "KSh " + balance.toFixed(2);

  players.forEach(p => {
    $(p.bet).disabled = phase !== "waiting" || p.active;
    $(p.cash).disabled = phase !== "running" || !p.active;
  });
}

function placeBet(i) {
  const p = players[i];
  const stake = Number($(p.input).value);

  if (phase !== "waiting" || p.active) return;
  if (!Number.isFinite(stake) || stake < 10 || stake > balance) {
    $(p.msg).textContent = "Enter a valid stake (minimum KSh 10).";
    return;
  }

  balance -= stake;
  p.stake = stake;
  p.active = true;
  $(p.result).textContent = "KSh " + stake.toFixed(2);
  $(p.msg).textContent = "Bet placed!";
  sound(650);
  update();
}

function cashOut(i) {
  const p = players[i];
  if (phase !== "running" || !p.active) return;

  const winnings = p.stake * multiplier;
  balance += winnings;
  p.active = false;
  $(p.result).textContent = "KSh " + winnings.toFixed(2);
  $(p.msg).textContent = "Cashed out at " + multiplier.toFixed(2) + "x!";
  sound(950);
  update();
}

players.forEach((p, i) => {
  $(p.bet).addEventListener("click", () => placeBet(i));
  $(p.cash).addEventListener("click", () => cashOut(i));
});

function startWaiting() {
  phase = "waiting";
  multiplier = 1;
  $("aviator-multiplier").textContent = "1.00x";
  $("flight-status").textContent = "NEXT FLIGHT SOON";
  $("crash-message").classList.remove("show");

  players.forEach(p => {
    p.active = false;
    p.stake = 0;
    $(p.msg).textContent = "Place your bet";
    $(p.result).textContent = "";
  });

  update();

  let seconds = 5;
  const countdown = setInterval(() => {
    if (phase !== "waiting") return clearInterval(countdown);
    $("flight-status").textContent = "TAKEOFF IN " + seconds;
    if (seconds <= 3 && seconds > 0) sound(500 + seconds * 100);
    seconds--;

    if (seconds < 0) {
      clearInterval(countdown);
      startFlight();
    }
  }, 1000);
}

function startFlight() {
  phase = "running";
  const thisRound = ++round;
  const crashAt = 1 + Math.random() * 9;
  const started = Date.now();

  $("flight-status").textContent = "FLYING";
  sound(350, 0.4);
  update();

  const timer = setInterval(() => {
    if (thisRound !== round) return clearInterval(timer);

    multiplier = Math.exp((Date.now() - started) / 1000 * 0.16);
    $("aviator-multiplier").textContent = multiplier.toFixed(2) + "x";

    const x = Math.min(95, (Date.now() - started) / 1000 * 5);
    const y = Math.max(5, 85 - multiplier * 5);
    $("plane-position").setAttribute("transform", `translate(${x},${y})`);
    $("flight-line").setAttribute("d", `M 0 90 Q ${x / 2} 90 ${x} ${y}`);
    $("flight-area").setAttribute("d", `M 0 90 Q ${x / 2} 90 ${x} ${y} L ${x} 100 L 0 100 Z`);

    if (multiplier >= crashAt) {
      clearInterval(timer);
      crash();
    }
  }, 100);
}

function crash() {
  phase = "crashed";
  $("flight-status").textContent = "CRASHED!";
  $("crash-result").textContent = multiplier.toFixed(2) + "x";
  $("crash-message").classList.add("show");
  sound(120, 0.6);

  players.forEach(p => {
    if (p.active) {
      p.active = false;
      $(p.msg).textContent = "Flew away! Bet lost.";
      $(p.result).textContent = "KSh 0.00";
    }
  });

  $("aviator-history").insertAdjacentHTML(
    "afterbegin", `<span>${multiplier.toFixed(2)}x</span>`
  );

  while ($("aviator-history").children.length > 10) {
    $("aviator-history").lastElementChild.remove();
  }

  update();
  setTimeout(startWaiting, 3000);
}

showInitial();

function showInitial() {
  update();
  startWaiting();
    }
