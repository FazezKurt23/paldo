/* ROMIE PALDO — frontend-only demo. Demo points only, no real money. */
(function () {
  "use strict";

  var ROWS = 4;
  var COLS = 5;
  var START_BALANCE = 10000;
  var MIN_BET = 1;
  var MAX_BET = 500;

  // 12 non-scatter symbols: with only 9 symbols in 20 cells, a 3-match was
  // mathematically forced every spin (pigeonhole) — the old "always win" bug.
  var NON_SCATTER = ["A", "K", "Q", "J", "10", "♥", "♦", "♠", "♣", "ACE", "💎", "👑"];
  var SCATTER_RATE = 0.035;        // per-cell scatter chance on paid spins
  var SCATTER_RATE_FREE = 0.045;   // slightly luckier during free spins
  var DEAD_SPIN_CHANCE = 0.45;     // share of paid spins dealt as guaranteed dead boards
  var DEAD_SPIN_CHANCE_FREE = 0.30;
  var DEAD_MSGS = ["No win — try again!", "Dead spin. Walay daog!", "Sayang! Spin again…", "No match — laban lang!"];
  var PAYOUT = { 3: 2, 4: 5, 5: 20 }; // x bet x multiplier (5 also covers 6+)
  var SCATTER_PAY = { 3: 5, 4: 15, 5: 50 };
  var FREE_SPINS_AWARD = 10;
  var FREE_RETRIGGER = 5;
  var BUY_MULT = 100; // buy-bonus price = 100x current bet

  var state = {
    balance: START_BALANCE,
    bet: 20,
    win: 0,
    spinning: false,
    sound: true,
    multiplier: 1,
    freeSpins: 0,      // remaining free spins (auto-played)
    freeTotal: 0,      // accumulated win during current free round
    freeBet: 20,       // bet locked in when free round triggered
    inFreeRound: false,
    bonusMode: null    // 'trigger' | 'complete' | null
  };

  // ---- DOM ----
  var reelsEl = document.getElementById("reels");
  var balanceEl = document.getElementById("balance");
  var winEl = document.getElementById("winAmount");
  var winMsgEl = document.getElementById("winMessage");
  var spinBtn = document.getElementById("spinBtn");
  var spinSub = document.getElementById("spinSub");
  var resetBtn = document.getElementById("resetBtn");
  var soundBtn = document.getElementById("soundBtn");
  var betInput = document.getElementById("betInput");
  var betMinus = document.getElementById("betMinus");
  var betPlus = document.getElementById("betPlus");
  var overlay = document.getElementById("bonusOverlay");
  var bonusTitle = document.getElementById("bonusTitle");
  var bonusText = document.getElementById("bonusText");
  var bonusSub = document.getElementById("bonusSub");
  var claimBtn = document.getElementById("claimBtn");
  var particlesEl = document.getElementById("particles");
  var machineEl = document.getElementById("machine");
  var freeBanner = document.getElementById("freeBanner");
  var freeCountEl = document.getElementById("freeCount");
  var freeTotalEl = document.getElementById("freeTotal");
  var buyBtn = document.getElementById("buyBtn");
  var buyPriceEl = document.getElementById("buyPrice");
  var multEls = {
    1: document.getElementById("mult-1"),
    2: document.getElementById("mult-2"),
    3: document.getElementById("mult-3"),
    5: document.getElementById("mult-5")
  };

  var cells = []; // cells[col][row] -> { cell, sym }
  var spinTimers = [];

  // ---- SOUND (WebAudio, no files) ----
  var audioCtx = null;
  function ctx() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function beep(freq, dur, type, vol, delay) {
    if (!state.sound) return;
    try {
      var c = ctx();
      if (!c) return;
      var t = c.currentTime + (delay || 0);
      var o = c.createOscillator();
      var g = c.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol || 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (dur || 0.12));
      o.connect(g);
      g.connect(c.destination);
      o.start(t);
      o.stop(t + (dur || 0.12) + 0.02);
    } catch (e) { /* sound is optional */ }
  }
  var sfx = {
    click: function () { beep(700, 0.07, "square", 0.06); },
    tick: function () { beep(320 + Math.random() * 200, 0.05, "square", 0.045); },
    stop: function () { beep(220, 0.09, "triangle", 0.12); },
    win: function () { beep(523, 0.12, "sine", 0.14); beep(659, 0.12, "sine", 0.14, 0.1); beep(784, 0.2, "sine", 0.16, 0.2); },
    big: function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { beep(f, 0.16, "sawtooth", 0.07, i * 0.09); }); },
    scatter: function () { [392, 523, 659, 784, 1047, 1568].forEach(function (f, i) { beep(f, 0.18, "triangle", 0.14, i * 0.1); }); }
  };

  // ---- GRID ----
  function symbolClass(sym) {
    if (sym === "SCATTER") return "symbol scatter-sym";
    if (sym === "♥" || sym === "♦") return "symbol suit-red";
    if (sym === "♠" || sym === "♣") return "symbol suit-black";
    if (sym === "ACE") return "symbol ace";
    if (sym === "💎") return "symbol gem";
    if (sym === "👑") return "symbol crown";
    return "symbol face";
  }

  function buildGrid() {
    reelsEl.innerHTML = "";
    cells = [];
    for (var c = 0; c < COLS; c++) {
      cells[c] = [];
      for (var r = 0; r < ROWS; r++) {
        var cell = document.createElement("div");
        cell.className = "cell";
        cell.dataset.col = c;
        cell.dataset.row = r;
        var sym = document.createElement("div");
        sym.className = symbolClass("A");
        sym.textContent = "A";
        cell.appendChild(sym);
        // order row-major visually: append in column order still forms grid correctly
        reelsEl.appendChild(cell);
        cells[c][r] = { cell: cell, sym: sym };
      }
    }
  }

  function randomSymbol(isFree) {
    var rate = isFree ? SCATTER_RATE_FREE : SCATTER_RATE;
    if (Math.random() < rate) return "SCATTER";
    return NON_SCATTER[Math.floor(Math.random() * NON_SCATTER.length)];
  }

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // Guaranteed dead board: every symbol appears at most 2x, scatters at most 2.
  function generateDeadBoard() {
    var order = shuffle(NON_SCATTER.slice());
    var bag = [];
    var i, k;
    for (i = 0; i < 8; i++) { bag.push(order[i]); bag.push(order[i]); } // 16 cells, each 2x
    for (i = 8; i < 12; i++) bag.push(order[i]);                        // 4 cells, each 1x
    bag = shuffle(bag);
    // sprinkle 0–2 scatters (replacing only lowers other counts, board stays dead)
    var nSc = Math.random() < 0.5 ? (Math.random() < 0.5 ? 1 : 2) : 0;
    for (k = 0; k < nSc; k++) bag[Math.floor(Math.random() * bag.length)] = "SCATTER";
    return bag;
  }

  // Live board: pure weighted luck (usually pays small, sometimes big or nothing)
  function generateLiveBoard(isFree) {
    var bag = [];
    for (var i = 0; i < ROWS * COLS; i++) bag.push(randomSymbol(isFree));
    return bag;
  }

  // Flat 20-cell bag → grid[col][row]
  function dealBoard(bag) {
    var grid = [];
    var n = 0;
    for (var c = 0; c < COLS; c++) {
      grid[c] = [];
      for (var r = 0; r < ROWS; r++) grid[c][r] = bag[n++];
    }
    return grid;
  }

  function setCell(c, r, value) {
    var slot = cells[c][r];
    slot.sym.textContent = value === "SCATTER" ? "★ SCATTER ★" : value;
    slot.sym.className = symbolClass(value);
    slot.cell.classList.toggle("scatter", value === "SCATTER");
  }

  function randomizeAll() {
    for (var c = 0; c < COLS; c++)
      for (var r = 0; r < ROWS; r++) setCell(c, r, randomSymbol());
  }

  // ---- HUD ----
  function fmt(n) {
    return Number(n).toLocaleString("en-US");
  }
  function fmtWin(n) {
    return Number(n).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  function refreshHud() {
    balanceEl.textContent = fmt(state.balance);
    if (state.inFreeRound) {
      spinSub.textContent = "FREE SPIN";
      spinBtn.querySelector(".spin-text").textContent = "FREE";
    } else {
      spinSub.textContent = "BET " + state.bet;
      spinBtn.querySelector(".spin-text").textContent = "SPIN";
    }
    if (document.activeElement !== betInput) betInput.value = state.bet;
    // free spins banner
    if (state.inFreeRound || state.freeSpins > 0) {
      freeBanner.classList.remove("hidden");
      machineEl.classList.add("free-active");
      freeCountEl.textContent = state.freeSpins;
      freeTotalEl.textContent = fmt(state.freeTotal);
    } else {
      freeBanner.classList.add("hidden");
      machineEl.classList.remove("free-active");
    }
    var lockBet = state.inFreeRound || state.spinning;
    betMinus.disabled = lockBet;
    betPlus.disabled = lockBet;
    betInput.disabled = lockBet;
    // buy-bonus price follows the bet; disabled while busy or if unaffordable
    buyPriceEl.textContent = fmt(buyPrice());
    buyBtn.disabled = lockBet || state.balance < buyPrice();
  }
  function effectiveBet() {
    return state.inFreeRound ? state.freeBet : state.bet;
  }
  function animateWin(to) {
    var from = 0;
    var start = performance.now();
    var dur = 600;
    function frame(t) {
      var p = Math.min(1, (t - start) / dur);
      winEl.textContent = fmtWin(from + (to - from) * p);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function setMultiplier(m) {
    state.multiplier = m;
    Object.keys(multEls).forEach(function (k) {
      multEls[k].classList.toggle("active", Number(k) === m);
    });
  }
  function clearHighlights() {
    for (var c = 0; c < COLS; c++)
      for (var r = 0; r < ROWS; r++)
        cells[c][r].cell.classList.remove("win", "scatter-win", "landed");
  }

  // ---- CONFETTI ----
  function confetti(n) {
    var colors = ["#ffd700", "#ff2244", "#a855f7", "#7CFC98", "#ffffff", "#ff9d00"];
    for (var i = 0; i < n; i++) {
      var p = document.createElement("div");
      p.className = "particle";
      p.style.left = Math.random() * 100 + "vw";
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 1.4 + Math.random() * 1.6 + "s";
      p.style.animationDelay = Math.random() * 0.4 + "s";
      p.style.transform = "rotate(" + Math.random() * 360 + "deg)";
      particlesEl.appendChild(p);
      (function (el) { setTimeout(function () { el.remove(); }, 3400); })(p);
    }
  }

  // ---- WIN DETECTION (scatter-pays: count anywhere in 5x4) ----
  function checkWins() {
    var counts = {};
    var scatterCells = [];
    for (var c = 0; c < COLS; c++) {
      for (var r = 0; r < ROWS; r++) {
        var v = cells[c][r].sym.textContent;
        var raw = v.indexOf("SCATTER") !== -1 ? "SCATTER" : v;
        counts[raw] = (counts[raw] || 0) + 1;
        if (raw === "SCATTER") scatterCells.push(cells[c][r]);
      }
    }

    var total = 0;
    var winners = [];
    var bet = effectiveBet();
    Object.keys(counts).forEach(function (sym) {
      if (sym === "SCATTER") return;
      var n = counts[sym];
      if (n >= 3) {
        var tier = n >= 5 ? 5 : n;
        total += bet * PAYOUT[tier] * state.multiplier;
        winners.push(sym);
      }
    });

    // highlight winning symbol cells
    winners.forEach(function (sym) {
      for (var c = 0; c < COLS; c++)
        for (var r = 0; r < ROWS; r++) {
          var v = cells[c][r].sym.textContent;
          if (v === sym) cells[c][r].cell.classList.add("win");
        }
    });

    // scatter bonus
    var sc = counts.SCATTER || 0;
    var scatterBonus = 0;
    if (sc >= 3) {
      var stier = sc >= 5 ? 5 : sc;
      scatterBonus = bet * SCATTER_PAY[stier] * state.multiplier;
      scatterCells.forEach(function (s) { s.cell.classList.add("scatter-win"); });
      total += scatterBonus;
    }

    return { total: total, scatterCount: sc, scatterBonus: scatterBonus, winners: winners };
  }

  // ---- SCATTER BONUS: instant points + 10 FREE SPINS ----
  function showScatterTrigger(sc, amount) {
    state.bonusMode = "trigger";
    bonusTitle.textContent = "SCATTER BONUS!";
    bonusText.textContent = "+" + fmt(amount) + " demo points (" + sc + "× SCATTER ×" + state.multiplier + ")";
    bonusSub.textContent = "🎁 You won " + FREE_SPINS_AWARD + " FREE SPINS!";
    bonusSub.style.display = "";
    claimBtn.textContent = "START FREE SPINS ▶";
    overlay.classList.remove("hidden");
    sfx.scatter();
    confetti(90);
  }
  function showFreeComplete(totalWin) {
    state.bonusMode = "complete";
    bonusTitle.textContent = "FREE SPINS COMPLETE!";
    bonusText.textContent = "Total free win: +" + fmt(totalWin) + " demo points";
    bonusSub.textContent = "🎉 Nice! Press COLLECT to continue.";
    bonusSub.style.display = "";
    claimBtn.textContent = "COLLECT";
    overlay.classList.remove("hidden");
    sfx.big();
    confetti(120);
  }
  function hideBonus() {
    overlay.classList.add("hidden");
    if (!state.inFreeRound) state.bonusMode = null;
  }

  function startFreeRound() {
    state.inFreeRound = true;
    state.freeSpins = FREE_SPINS_AWARD;
    state.freeTotal = 0;
    refreshHud();
    // small pause so the player sees the banner, then auto-play
    setTimeout(runNextFreeSpin, 900);
  }

  function runNextFreeSpin() {
    if (state.freeSpins <= 0) {
      endFreeRound();
      return;
    }
    doSpin(true);
  }

  function endFreeRound() {
    state.inFreeRound = false;
    state.freeSpins = 0;
    state.spinning = false;
    spinBtn.disabled = false;
    refreshHud();
    showFreeComplete(state.freeTotal);
  }

  // ---- SPIN ----
  function stopAllTimers() {
    spinTimers.forEach(clearInterval);
    spinTimers = [];
  }

  // Normal paid spin (blocked while a free round auto-plays)
  function spin() {
    if (state.spinning || state.inFreeRound) return;
    doSpin(false);
  }

  // isFree=true: no bet deducted, uses locked freeBet, decrements freeSpins
  function doSpin(isFree) {
    if (state.spinning) return;
    if (!isFree && state.balance < state.bet) {
      winMsgEl.textContent = "Out of points — press RESET.";
      sfx.click();
      return;
    }
    state.spinning = true;
    spinBtn.disabled = true;
    overlay.classList.add("hidden");
    clearHighlights();
    winEl.textContent = fmtWin(0);

    if (isFree) {
      state.freeSpins -= 1;
      winMsgEl.textContent = "FREE SPIN… (" + state.freeSpins + " left)";
    } else {
      state.balance -= state.bet;
      winMsgEl.textContent = "Spinning…";
    }
    refreshHud();

    // random multiplier highlight each spin
    var mults = [1, 2, 3, 5];
    setMultiplier(mults[Math.floor(Math.random() * mults.length)]);
    sfx.click();

    // start blur animation on all reels + fast symbol cycling
    for (var c = 0; c < COLS; c++)
      for (var r = 0; r < ROWS; r++) cells[c][r].cell.classList.add("spinning");

    var cycler = setInterval(function () {
      for (var c = 0; c < COLS; c++)
        for (var r = 0; r < ROWS; r++) {
          if (!cells[c][r].cell.classList.contains("spinning")) continue;
          setCell(c, r, randomSymbol());
        }
      sfx.tick();
    }, 90);
    spinTimers.push(cycler);

    // stop reels left → right with stagger
    // ~45% of paid spins (30% of free spins) are dealt as dead boards
    var deadRoll = Math.random() < (isFree ? DEAD_SPIN_CHANCE_FREE : DEAD_SPIN_CHANCE);
    var finalGrid = dealBoard(deadRoll ? generateDeadBoard() : generateLiveBoard(isFree));

    for (var c3 = 0; c3 < COLS; c3++) {
      (function (col) {
        setTimeout(function () {
          for (var r = 0; r < ROWS; r++) {
            setCell(col, r, finalGrid[col][r]);
            cells[col][r].cell.classList.remove("spinning");
            cells[col][r].cell.classList.add("landed");
          }
          sfx.stop();
          if (col === COLS - 1) finishSpin();
        }, 500 + col * 350);
      })(c3);
    }
  }

  function finishSpin() {
    stopAllTimers();
    var res = checkWins();
    var bet = effectiveBet();
    state.win = res.total;
    state.balance += res.total;
    animateWin(res.total);

    if (state.inFreeRound) {
      // --- inside a free round: accumulate, retrigger, keep auto-playing ---
      state.freeTotal += res.total;
      var msg;
      if (res.scatterCount >= 3) {
        state.freeSpins += FREE_RETRIGGER;
        msg = "RETRIGGER! +" + FREE_RETRIGGER + " FREE SPINS 🎁";
        sfx.scatter();
        confetti(80);
      } else if (res.total > 0) {
        msg = "FREE WIN +" + fmt(res.total) + " ×" + state.multiplier;
        if (res.total >= bet * 10) { sfx.big(); confetti(60); } else { sfx.win(); confetti(25); }
      } else {
        msg = "Free spin… no win (" + state.freeSpins + " left)";
      }
      winMsgEl.textContent = msg;
      refreshHud();
      state.spinning = false;
      // keep SPIN disabled; chain the next free spin automatically
      setTimeout(runNextFreeSpin, 1100);
      return;
    }

    // --- normal paid spin ---
    refreshHud();
    if (res.scatterCount >= 3) {
      winMsgEl.textContent = "SCATTER BONUS! " + res.scatterCount + "× SCATTER ×" + state.multiplier;
      if (res.total >= bet * 10) confetti(60);
      // lock current bet for the free round, then prompt to start it
      state.freeBet = state.bet;
      state.spinning = false; // free round takes over the button from here
      refreshHud();
      showScatterTrigger(res.scatterCount, res.scatterBonus);
      return;
    } else if (res.total > 0) {
      var big = res.total >= bet * 10;
      winMsgEl.textContent = big ? "BIG WIN! ×" + state.multiplier + " multiplier!" : "Win! ×" + state.multiplier + " multiplier — " + res.winners.join(", ");
      if (big) { sfx.big(); confetti(70); } else { sfx.win(); confetti(25); }
    } else {
      winMsgEl.textContent = DEAD_MSGS[Math.floor(Math.random() * DEAD_MSGS.length)];
    }

    state.spinning = false;
    spinBtn.disabled = false;
  }

  // ---- CONTROLS ----
  function clampBet(v) {
    v = Math.round(Number(v));
    if (isNaN(v)) v = state.bet;
    return Math.min(MAX_BET, Math.max(MIN_BET, v));
  }
  betMinus.addEventListener("click", function () { if (state.inFreeRound) return; state.bet = clampBet(state.bet - 10); refreshHud(); sfx.click(); });
  betPlus.addEventListener("click", function () { if (state.inFreeRound) return; state.bet = clampBet(state.bet + 10); refreshHud(); sfx.click(); });
  betInput.addEventListener("change", function () { if (state.inFreeRound) { refreshHud(); return; } state.bet = clampBet(betInput.value); refreshHud(); });

  function buyPrice() {
    return state.bet * BUY_MULT;
  }
  function showBuyBonus(price) {
    state.bonusMode = "trigger"; // claim button will start the free round
    bonusTitle.textContent = "🎁 BONUS BOUGHT!";
    bonusText.textContent = "-" + fmt(price) + " demo points (100× BET " + state.bet + ")";
    bonusSub.textContent = "10 FREE SPINS at BET " + state.freeBet + " — good luck!";
    bonusSub.style.display = "";
    claimBtn.textContent = "START FREE SPINS ▶";
    overlay.classList.remove("hidden");
    sfx.scatter();
    confetti(90);
  }
  buyBtn.addEventListener("click", function () {
    if (state.spinning || state.inFreeRound) return;
    var price = buyPrice();
    if (state.balance < price) {
      winMsgEl.textContent = "Not enough points — need " + fmt(price) + " for bonus.";
      sfx.click();
      return;
    }
    state.balance -= price;
    state.freeBet = state.bet; // free round pays at the bet you bought in with
    refreshHud();
    showBuyBonus(price);
  });

  spinBtn.addEventListener("click", spin);
  claimBtn.addEventListener("click", function () {
    sfx.click();
    if (state.bonusMode === "trigger") {
      overlay.classList.add("hidden");
      state.bonusMode = null;
      startFreeRound();
    } else {
      // 'complete' summary or plain collect
      overlay.classList.add("hidden");
      state.bonusMode = null;
      spinBtn.focus();
    }
  });
  overlay.addEventListener("click", function (e) {
    // only allow dismissing the final summary by backdrop click;
    // the trigger popup must use the START button so free spins aren't skipped
    if (e.target === overlay && state.bonusMode !== "trigger") {
      overlay.classList.add("hidden");
      state.bonusMode = null;
    }
  });

  resetBtn.addEventListener("click", function () {
    if (state.spinning || state.inFreeRound) return;
    stopAllTimers();
    state.balance = START_BALANCE;
    state.win = 0;
    state.bet = clampBet(betInput.value || 20);
    state.freeSpins = 0;
    state.freeTotal = 0;
    state.inFreeRound = false;
    state.bonusMode = null;
    overlay.classList.add("hidden");
    clearHighlights();
    randomizeAll();
    setMultiplier(1);
    winEl.textContent = fmtWin(0);
    winMsgEl.textContent = "Balance reset. Good luck!";
    refreshHud();
    sfx.click();
  });

  soundBtn.addEventListener("click", function () {
    state.sound = !state.sound;
    soundBtn.textContent = state.sound ? "🔊 SOUND: ON" : "🔇 SOUND: OFF";
    if (state.sound) sfx.click();
  });

  // ---- INIT ----
  buildGrid();
  randomizeAll();
  setMultiplier(1);
  refreshHud();
})();
