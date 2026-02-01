(() => {
  const STORAGE_KEY = "parity_trainer_stats_v1";
  const CONFIG_KEY  = "parity_trainer_config_v1";

  const COLORS = [
    { name: "Blue",   hex: "#4b8bff" },
    { name: "Red",    hex: "#ff4b4b" },
    { name: "Green",  hex: "#3fe08f" },
    { name: "Orange", hex: "#ff9f43" },
  ];

  // --- Settings UI (modal) ---
  const openSettingsBtn = document.getElementById("openSettings");
  const closeSettingsBtn = document.getElementById("closeSettings");
  const settingsModal = document.getElementById("settingsModal");
  const settingsBackdrop = document.getElementById("settingsBackdrop");

  const msRange = document.getElementById("msRange");
  const msVal = document.getElementById("msVal");

  const explainToggle = document.getElementById("explainToggle");
  const switchEl = document.getElementById("switch");

  const manualToggle = document.getElementById("manualToggle");
  const manualSwitchEl = document.getElementById("manualSwitch");
  const delayRow = document.getElementById("delayRow");

  // --- Stats UI ---
  const scoreEl = document.getElementById("score");
  const totalEl = document.getElementById("total");
  const avgEl = document.getElementById("avgTime");

  // --- Stage UI ---
  const singleStage = document.getElementById("singleStage");
  const rowNormalEl = document.getElementById("rowNormal");
  const singleSwatch = document.getElementById("singleSwatch");

  const normalSwatches = [
    document.getElementById("n0"),
    document.getElementById("n1"),
    document.getElementById("n2"),
  ];

  const btnOdd = document.getElementById("btnOdd");
  const btnEven = document.getElementById("btnEven");
  const startBtn = document.getElementById("startBtn");
  const resetBtn = document.getElementById("resetScores");

  let ms = Number(msRange.value) || 500;

  let manualMode = false;

  // manualStep: 0 idle, 1 showing first, 2 showing second, 3 showing third (awaiting answer)
  let manualStep = 0;
  let manualTimerStarted = false;

  let running = false;
  let awaitingAnswer = false;

  let currentSeq = [];
  let currentParity = null;
  let currentStrikeIdx = null;

  let score = 0;
  let total = 0;

  let responseSumMs = 0;
  let responseCount = 0;
  let responseStartMs = null;

  let blinkTimer = null;
  let blinkOn = true;
  let feedbackTimer = null;


  const PARITIES = new Set([
    "012", "120", "201",
    "023", "230", "302",
    "031", "310", "103",
    "132", "321", "213"
  ]);

  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);

      if (typeof obj.explain === "boolean") explainToggle.checked = obj.explain;
      if (typeof obj.manualMode === "boolean") manualMode = obj.manualMode;
      if (Number.isFinite(obj.ms)) ms = obj.ms;

    } catch { /* ignore */ }
  }

  function saveConfig() {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({
        explain: explainToggle.checked,
        manualMode,
        ms
      }));
    } catch { /* ignore */ }
  }

  function syncManualUI() {
    manualToggle.checked = manualMode;
    manualSwitchEl.classList.toggle("on", manualMode);

    delayRow.style.display = manualMode ? "none" : "flex";

    msRange.value = String(ms);
    msVal.textContent = String(ms);

  }

  function syncExplainUI() {
    switchEl.classList.toggle("on", explainToggle.checked);

    if (rowNormalEl.style.display !== "none" && currentStrikeIdx !== null) {
      if (explainToggle.checked) applyBlinkStrike(currentStrikeIdx);
      else stopBlink();
    }
  }

  function loadStats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (Number.isFinite(obj.score)) score = obj.score;
      if (Number.isFinite(obj.total)) total = obj.total;
      if (Number.isFinite(obj.responseSumMs)) responseSumMs = obj.responseSumMs;
      if (Number.isFinite(obj.responseCount)) responseCount = obj.responseCount;
    } catch { }
  }

  function saveStats() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        score, total, responseSumMs, responseCount
      }));
    } catch { }
  }

  function avgSeconds() {
    if (!responseCount) return 0;
    return (responseSumMs / responseCount) / 1000;
  }

  function renderStats() {
    scoreEl.textContent = String(score);
    totalEl.textContent = String(total);
    avgEl.textContent = avgSeconds().toFixed(2);
  }

  function sleep(t) { return new Promise(r => setTimeout(r, t)); }

  function clearFeedback() { document.body.classList.remove("ok", "bad"); }
  function flashFeedback(ok) {
    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }

    document.body.classList.remove("ok", "bad");
    document.body.classList.add(ok ? "ok" : "bad");

    feedbackTimer = setTimeout(() => {
      clearFeedback();
      feedbackTimer = null;
    }, 441); 
  }

  function showSingle() {
    rowNormalEl.style.display = "none";
    singleStage.style.display = "flex";
  }
  function showRow() {
    singleStage.style.display = "none";
    rowNormalEl.style.display = "flex";
  }

  function setSingleColor(idx) {
    singleSwatch.style.background = COLORS[idx].hex;
  }

  function fillNormalRow(seq) {
    for (let i = 0; i < 3; i++) {
      normalSwatches[i].style.background = COLORS[seq[i]].hex;
      normalSwatches[i].classList.remove("strike", "blinkOff");
    }
  }

  function pick3DistinctFrom4() {
    const arr = [0, 1, 2, 3];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, 3);
  }

  function inversionParity(seq) {
    return PARITIES.has(seq.join(""));
  }

  function strikeIndexByRule(seq) {
    const isGroupA = (v) => (v === 0 || v === 2);
    const groupApos = [];
    const groupBpos = [];
    for (let i = 0; i < 3; i++) {
      (isGroupA(seq[i]) ? groupApos : groupBpos).push(i);
    }
    const oddPos = (groupApos.length === 1) ? groupApos[0] : groupBpos[0];
    if (oddPos === 0) return 2;
    if (oddPos === 1) return 0;
    return 1;
  }

  function stopBlink() {
    if (blinkTimer) clearInterval(blinkTimer);
    blinkTimer = null;
    blinkOn = true;
    for (const sw of normalSwatches) sw.classList.remove("strike", "blinkOff");
  }

  function applyBlinkStrike(strikeIdx) {
    for (let i = 0; i < 3; i++) {
      normalSwatches[i].classList.toggle("strike", i === strikeIdx);
      normalSwatches[i].classList.remove("blinkOff");
    }
    if (!explainToggle.checked) return;

    if (blinkTimer) clearInterval(blinkTimer);
    blinkOn = true;

    blinkTimer = setInterval(() => {
      blinkOn = !blinkOn;
      normalSwatches[strikeIdx].classList.toggle("blinkOff", !blinkOn);
    }, 240);
  }

  function setButtonsEnabled(enabled) {
    btnOdd.disabled = !enabled;
    btnEven.disabled = !enabled;
  }

  function resetButtonFeedback() {
    btnOdd.classList.remove("ok", "bad");
    btnEven.classList.remove("ok", "bad");
  }

  async function startRoundAuto() {

    if (running) return;

    stopBlink();
    clearFeedback();
    resetButtonFeedback();

    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }


    setButtonsEnabled(false);
    awaitingAnswer = false;
    responseStartMs = null;

    running = true;

    currentSeq = pick3DistinctFrom4();
    currentParity = inversionParity(currentSeq);
    currentStrikeIdx = null;

    showSingle();

    setSingleColor(currentSeq[0]);
    await sleep(ms);

    setSingleColor(currentSeq[1]);
    await sleep(ms);

    setSingleColor(currentSeq[2]);

    responseStartMs = performance.now();
    awaitingAnswer = true;
    setButtonsEnabled(true);

    await sleep(ms);

    running = false;
  }

  function resetManualCycleState() {
    manualStep = 0;
    manualTimerStarted = false;
  }

  function startRoundManualInitial() {
    if (running) return;

    stopBlink();
    clearFeedback();
    resetButtonFeedback();

    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }

    setButtonsEnabled(false);
    awaitingAnswer = false;
    responseStartMs = null;

    running = true;

    currentSeq = pick3DistinctFrom4();
    currentParity = inversionParity(currentSeq);
    currentStrikeIdx = null;

    showSingle();

    resetManualCycleState();
    setSingleColor(currentSeq[0]); 
    singleSwatch.style.background = "rgba(255,255,255,0.06)";
  }

  function manualAdvanceFromInput() {
    if (feedbackTimer) {
      clearTimeout(feedbackTimer); feedbackTimer = null; 
    }
    document.body.classList.remove("ok","bad");
    btnOdd.classList.remove("ok","bad");
    btnEven.classList.remove("ok","bad");
    

    if (!running && !awaitingAnswer) {
      startRoundManualInitial();
    }

    if (!running && !awaitingAnswer) return;

    if (awaitingAnswer) return;

    if (manualStep === 0) {
      setSingleColor(currentSeq[0]);
      manualStep = 1;

      if (!manualTimerStarted) {
        responseStartMs = performance.now(); 
        manualTimerStarted = true;
      }
      return;
    }

    if (manualStep === 1) {
      setSingleColor(currentSeq[1]);
      manualStep = 2;
      return;
    }

    if (manualStep === 2) {
      setSingleColor(currentSeq[2]);
      manualStep = 3;

      awaitingAnswer = true;
      setButtonsEnabled(true);
      return;
    }

  }

  function submitAnswer(ansIsOdd, sourceBtn) {
    if (!awaitingAnswer) return;

    awaitingAnswer = false;
    setButtonsEnabled(false);

    total++;
    const ok = (ansIsOdd === currentParity);
    if (ok) score++;

    if (responseStartMs != null) {
      const dt = Math.max(0, performance.now() - responseStartMs);
      responseSumMs += dt;
      responseCount += 1;
    }

    renderStats();
    saveStats();

    flashFeedback(ok);
    sourceBtn.classList.add(ok ? "ok" : "bad");

    fillNormalRow(currentSeq);
    showRow();

    if (explainToggle.checked) {
      currentStrikeIdx = strikeIndexByRule(currentSeq);
      applyBlinkStrike(currentStrikeIdx);
    } else {
      currentStrikeIdx = null;
      stopBlink();
    }

    running = false;
    resetManualCycleState();
  }

  function doFullReset() {
    score = 0;
    total = 0;
    responseSumMs = 0;
    responseCount = 0;
    saveStats();
    renderStats();

    stopBlink();
    clearFeedback();
    resetButtonFeedback();
    showSingle();
    setButtonsEnabled(false);

    responseStartMs = null;
    awaitingAnswer = false;
    running = false;
    resetManualCycleState();
  }

  function openModal() {
    document.body.classList.add("modalOpen");
    settingsModal.setAttribute("aria-hidden", "false");
    settingsBackdrop.setAttribute("aria-hidden", "false");
  }
  function closeModal() {
    document.body.classList.remove("modalOpen");
    settingsModal.setAttribute("aria-hidden", "true");
    settingsBackdrop.setAttribute("aria-hidden", "true");
  }

  openSettingsBtn.addEventListener("click", openModal);
  closeSettingsBtn.addEventListener("click", closeModal);
  settingsBackdrop.addEventListener("click", closeModal);
  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && document.body.classList.contains("modalOpen")) {
      e.preventDefault();
      closeModal();
    }
  }, { passive:false });

  msRange.addEventListener("input", () => {
    ms = Number(msRange.value) || 500;
    msVal.textContent = String(ms);
    saveConfig();
  });

  switchEl.addEventListener("click", () => {
    explainToggle.checked = !explainToggle.checked;
    syncExplainUI();
    saveConfig();
  });
  explainToggle.addEventListener("change", () => {
    syncExplainUI();
    saveConfig();
  });

  function cleanState() {
    syncManualUI();
    saveConfig();

    stopBlink();
    clearFeedback();
    resetButtonFeedback();
    showSingle();
    setButtonsEnabled(false);
    awaitingAnswer = false;
    running = false;
    responseStartMs = null;
    resetManualCycleState();
    singleSwatch.style.background = "rgba(255,255,255,0.06)";
  }

  manualSwitchEl.addEventListener("click", () => {
    manualMode = !manualMode;
    cleanState();
  });

  manualToggle.addEventListener("change", () => {
    manualMode = !!manualToggle.checked;
    cleanState();
  });

  btnOdd.addEventListener("click", () => submitAnswer(true, btnOdd));
  btnEven.addEventListener("click", () => submitAnswer(false, btnEven));

  startBtn.addEventListener("click", () => {
    if (manualMode) {
      startRoundManualInitial();
    } else {
      startRoundAuto();
    }
  });

  resetBtn.addEventListener("click", () => { doFullReset(); });

  window.addEventListener("keydown", (e) => {
    switch (e.code) {
      case "Space":
        e.preventDefault();
        if (manualMode) {
          if (!awaitingAnswer && !running) startRoundManualInitial();
          manualAdvanceFromInput();
        } else {
          startRoundAuto();
        }
        break;

      case "ArrowLeft":
        if (!btnOdd.disabled) {
          submitAnswer(true, btnOdd);
        } else {
          if (manualMode) {
            if (!awaitingAnswer) {
              e.preventDefault();
              if (!running) startRoundManualInitial();
              manualAdvanceFromInput();
            } else if (!running && !awaitingAnswer) {
              // unreachable
            }
          } else {
            if (!awaitingAnswer && !running) {
              e.preventDefault();
              startRoundAuto();
            }
          }
        }
        break;

      case "ArrowRight":
        if (!btnEven.disabled) {
          submitAnswer(false, btnEven);
        } else {
          if (manualMode) {
            if (!awaitingAnswer) {
              e.preventDefault();
              if (!running) startRoundManualInitial();
              manualAdvanceFromInput();
            }
          } else {
            if (!awaitingAnswer && !running) {
              e.preventDefault();
              startRoundAuto();
            }
          }
        }
        break;

      case "KeyR":
        e.preventDefault();
        doFullReset();
        break;
    }
  }, { passive: false });

  document.addEventListener("pointerdown", (e) => {
    e.preventDefault(); 
    if (!manualMode) return;
    if (document.body.classList.contains("modalOpen")) return; 
    if (awaitingAnswer) return;

    const t = e.target;
    if (t && (t.closest && (t.closest("button") || t.closest(".modal") || t.closest(".modalBackdrop")))) return;

    if (!running) startRoundManualInitial();
    manualAdvanceFromInput();
  });

  document.addEventListener("touchend", (e) => {
    if (!manualMode) return;
    e.preventDefault(); 
  }, { passive: false });

  loadStats();
  loadConfig();

  msRange.value = String(ms);
  msVal.textContent = String(ms);

  // switch UIs
  syncExplainUI();
  syncManualUI();

  renderStats();
  showSingle();
  singleSwatch.style.background = "rgba(255,255,255,0.06)";
  setButtonsEnabled(false);
})();
