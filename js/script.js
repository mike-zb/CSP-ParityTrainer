(() => {
  const STORAGE_KEY = "parity_trainer_stats_v1";
  const CONFIG_KEY  = "parity_trainer_config_v1";


  const COLORS = [
    { name: "Blue",   hex: "#4b8bff" },
    { name: "Red",    hex: "#ff4b4b" },
    { name: "Green",  hex: "#3fe08f" },
    { name: "Orange", hex: "#ff9f43" }
  ];

  const UPDATE_EVERY_MS = 25;

  const Modes = Object.freeze({
    MANU: "MANU", 
    AUTO: "AUTO", 
    INSP: "INSP", 
  })

  // --- Settings UI (modal) ---
  const openSettingsBtn = document.getElementById("openSettings");
  const closeSettingsBtn = document.getElementById("closeSettings");
  const settingsModal = document.getElementById("settingsModal");
  const settingsBackdrop = document.getElementById("settingsBackdrop");

  const msRange = document.getElementById("msRange");
  const msVal = document.getElementById("msVal");

  const explainToggle = document.getElementById("explainToggle");
  const switchEl = document.getElementById("switch");

  const modeSelect = document.getElementById("modeSelect");

  const delayRow = document.getElementById("delayRow");

  // --- Stats UI ---
  const scoreEl = document.getElementById("score");
  const totalEl = document.getElementById("total");
  const avgEl = document.getElementById("avgTime");

  // --- Stage UI ---
  const singleStage = document.getElementById("singleStage");
  const rowNormalEl = document.getElementById("rowNormal");
  const allSwatches = document.getElementsByClassName("swatch");
  const singleSwatch = document.getElementById("singleSwatch");

  const normalSwatches = [
    document.getElementById("n0"),
    document.getElementById("n1"),
    document.getElementById("n2"),
  ];

  const btnOdd = document.getElementById("btnOdd");
  const btnEven = document.getElementById("btnEven");
  const resetBtn = document.getElementById("resetScores");

  const timerText = document.getElementById("roundTimer");

  let ms = Number(msRange.value) || 500;

  let mode = Modes.AUTO

  let manualStep = 0; // manualStep: 0 idle, 1 showing first, 2 showing second, 3 showing third (awaiting answer)
  let manualTimerStarted = false;

  let inspectionParityStage = 0;

  let running = false;
  let awaitingAnswer = false;

  let currentSeq = [];
  let currrentParityIsOdd = null;
  let currentStrikeIdx = null;

  let scores = {
    [Modes.AUTO]: { score: 0, total: 0, respSumMs: 0, respCount: 0 },
    [Modes.MANU]: { score: 0, total: 0, respSumMs: 0, respCount: 0 },
    [Modes.INSP]: { score: 0, total: 0, respSumMs: 0, respCount: 0 }
  }

  let responseStartMs = null;
  let blinkTimer = null;
  let blinkOn = true;
  let feedbackTimer = null;

  // timer display
  let rafId = 0;
  let lastPaint = 0;
  let roundTimeMs = null;
  let roundTimeSec = null;

  const PARITIES = new Set([
    "012", "120", "201",
    "023", "230", "302",
    "031", "310", "103",
    "132", "321", "213"
  ]);


  // ===== START CONFIGS =====
  // #region CONFIGS 
  // {
  function loadConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return;

      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return;
      if (typeof obj.explain === "boolean") explainToggle.checked = obj.explain;
      if (typeof obj.mode === "string" && Object.values(Modes).includes(obj.mode)) mode = obj.mode;
      if (Number.isFinite(obj.ms)) ms = obj.ms;

      modeSelect.value = mode;

    } catch {
      console.error("No settings were retrieved from LocalStorage")
    }
  }

  function saveConfig() {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify({
        explain: explainToggle.checked,
        mode,
        ms
      }));
    } catch { 
      console.error("Settings could not be saved")
    }
  }

  function loadStats() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return;

      Object.values(Modes).forEach(mode => {
        const data = obj[mode];
        if (!data || typeof data !== "object") return;

        if (Number.isFinite(data.score)) scores[mode].score = data.score; 
        if (Number.isFinite(data.total)) scores[mode].total = data.total;
        if (Number.isFinite(data.respSumMs)) scores[mode].respSumMs = data.respSumMs;
        if (Number.isFinite(data.respCount)) scores[mode].respCount = data.respCount;
      });
    } catch { 
      console.error("No scores were retrieved from LocalStorage")
    }
  }

  function saveStats() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(scores));
    } catch { 
      console.error("Scores could not be saved")
    }
  }

  // #endregion } 
  // ===== END CONFIGS =====

  // ===== START UI =====
  // #region UI 
  // { 
  function syncUI() {
    timerText.textContent = `0.00s`;
    singleSwatch.textContent = "START"; 
    switch(mode) {
      case Modes.AUTO: 
        delayRow.style.display = "flex";
        msRange.value = String(ms);
        msVal.textContent = String(ms);
        break;
      case Modes.MANU: 
        delayRow.style.display = "none";
        break; 
      case Modes.INSP:
        delayRow.style.display = "none";
        break;
    }

    renderStats();
  }

  function syncExplainUI() {
    switchEl.classList.toggle("on", explainToggle.checked);

    if (rowNormalEl.style.display !== "none" && currentStrikeIdx !== null) {
      if (explainToggle.checked) applyBlinkStrike(currentStrikeIdx);
      else stopBlink();
    }
  }

  function renderStats() {
    const {score, total, respSumMs, respCount } = getCurrentModeStats ()

    scoreEl.textContent = String(score);
    totalEl.textContent = String(total);
    let avg = !score ? 0 : (respSumMs / score) / 1000;
    avgEl.textContent = avg.toFixed(2);

  }

  function screenFlashFeedback(ok) {
    if (feedbackTimer) {
      clearTimeout(feedbackTimer);
      feedbackTimer = null;
    }

    document.body.classList.remove("ok", "bad");
    document.body.classList.add(ok ? "ok" : "bad");

    feedbackTimer = setTimeout(() => {
      document.body.classList.remove("ok", "bad"); 
      feedbackTimer = null;
    }, 441); 
  }

  function showNextColor() {
    singleStage.style.display = "flex";
    rowNormalEl.style.display = "none";
  }

  function showCurrentRoundCase() {
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

  function clearFeedbackColors() {
    document.body.classList.remove("ok","bad");
    btnOdd.classList.remove("ok", "bad");
    btnEven.classList.remove("ok", "bad");
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
  // #endregion } 
  // ===== END UI =====

  // ===== START Helpers =====
  // #region Helpers 
  // {

  function getCurrentModeStats () {
    return scores[mode];
  }

  function sleep(t) { return new Promise(r => setTimeout(r, t)); }

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

  function shouldIgnoreManualInputTarget(t) {
    return !!(t && t.closest && (t.closest("button") || t.closest("input") || t.closest(".modal") || t.closest(".modalBackdrop")));
  }
  // #endregion } 
  // ===== END Helpers =====

  // ===== START Logic =====
  // #region Logic 
  // {
  function pick3DistinctFrom4() {
    const arr = [0, 1, 2, 3];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr.slice(0, 3);
  }

  function isOddParity(seq) {
    return PARITIES.has(seq.join(""));
  }

  // #endregion } 
  // ===== END Logic =====

  // ===== START Trainer Flow =====
  // #region Flow 
  // {

  function clearEffects() {
    stopBlink();
    clearFeedbackColors();

    if (feedbackTimer) { clearTimeout(feedbackTimer); feedbackTimer = null; }
  }

  function startRoundSetUp() {

    setButtonsEnabled(false);
    awaitingAnswer = false;
    resetTimer();
 
    running = true;

    currentSeq = pick3DistinctFrom4();
    currrentParityIsOdd = isOddParity(currentSeq);
    currentStrikeIdx = null;

    showNextColor();

    singleSwatch.textContent = ""; 
    singleSwatch.style.background = "rgba(255,255,255,0.06)";
  }

  // ----- Auto mode -----
  async function startRoundAuto() {

    if (running) return;

    clearEffects();
    startRoundSetUp();

    await sleep(ms);
    setSingleColor(currentSeq[0]);

    await sleep(ms);
    setSingleColor(currentSeq[1]);

    await sleep(ms);
    setSingleColor(currentSeq[2]);

    startTimer();
    awaitingAnswer = true;
    setButtonsEnabled(true);

    // await sleep(ms);

    running = false;
  }

  // ---- Manual Mode 
  function startRoundManualInitial() {

    if (running) return;

    clearEffects();
    startRoundSetUp();

    resetManualCycleState();
  }

  function resetManualCycleState() {
    manualStep = 0;
    manualTimerStarted = false;
  }

  function manualAdvanceFromInput() {
    if (feedbackTimer) {
      clearTimeout(feedbackTimer); feedbackTimer = null; 
    }

    if (awaitingAnswer) return;

    if (manualStep === 0) {
      setSingleColor(currentSeq[0]);
      manualStep = 1;

      singleSwatch.textContent = ""; 

      if (!manualTimerStarted) {
        startTimer();
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

  // ---- Inspection Mode  
  function handleInspection() {
    if (!running && !awaitingAnswer ) {
      beginInspectionRound();
      return;
    }

    if (awaitingAnswer) return; // answer is handled elsewere 

    // has not started, here it begins 
    // it started, and it's advancing through manual stages 

    // if advancing, just continue with the next, do nothing to inspection status 
    inspectionAdvance();
  }

  function beginInspectionRound() {
    if (running) return;
    clearEffects();
    startRoundSetUp();
    resetManualCycleState();

    inspectionParityStage = 1; 
    inspectionRoundSetUp()
  }

  function inspectionRoundSetUp() {

    setButtonsEnabled(false);
    awaitingAnswer = false;

    running = true;

    currentSeq = pick3DistinctFrom4();
    currrentParityIsOdd = isOddParity(currentSeq);
    currentStrikeIdx = null;

    showNextColor();

    singleSwatch.textContent = inspectionParityStage; 
    singleSwatch.style.background = "rgba(255,255,255,0.06)";
  }

  function inspectionAdvance() {

    if (manualStep === 0) {
      clearEffects()
      setSingleColor(currentSeq[0]);
      manualStep = 1;

      singleSwatch.textContent = ""; 
      if (inspectionParityStage === 1) {
        startTimer()
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

  function submitInspectionAnswer(sourceBtn) {
    if (!awaitingAnswer) return; 
    awaitingAnswer = false;
    setButtonsEnabled(false);

    resetManualCycleState();
    const answerIsOdd = sourceBtn.dataset.parity == "1"
    const isAnswerCorrect = answerIsOdd === currrentParityIsOdd;

    const stats = getCurrentModeStats()
    screenFlashFeedback(isAnswerCorrect);

    if (!isAnswerCorrect){
      inspectionParityStage = 0;
      // TODO handle wrong response

      sourceBtn.classList.add("bad");
      stats.total++;

      stopTimer();
      handleRoundFinish()
      return; 
    }

    if(inspectionParityStage < 4 ) {
      inspectionParityStage++; 
      inspectionRoundSetUp();
      singleSwatch.textContent = inspectionParityStage; 
      return; 
    } 
    // stage 4 - handle round finish 
    stats.total++;
    stats.score++;
    sourceBtn.classList.add("ok");

    if (responseStartMs != null) {
      stopTimer();
      stats.respSumMs += roundTimeMs;
      stats.respCount += 1;
    }
    handleRoundFinish()

  }

  function handleRoundFinish() {
    renderStats();
    saveStats();
    fillNormalRow(currentSeq);
    showCurrentRoundCase();
    if (explainToggle.checked) {
      currentStrikeIdx = strikeIndexByRule(currentSeq);
      applyBlinkStrike(currentStrikeIdx);
    } 
    running = false;

    inspectionParityStage = 0; 

  }

  function submitAnswer(ansIsOdd, sourceBtn) {
    // debugger; 
    if (!awaitingAnswer) return;

    const stats = getCurrentModeStats()

    awaitingAnswer = false;
    setButtonsEnabled(false);

    stats.total++;
    const isAnswerCorrect = ansIsOdd === currrentParityIsOdd;


    if (responseStartMs != null) {
      stopTimer();
      stats.respCount += 1;
    }

    if (isAnswerCorrect) {
      stats.score++;
      stats.respSumMs += roundTimeMs;
    }

    renderStats();
    saveStats();

    screenFlashFeedback(isAnswerCorrect);
    sourceBtn.classList.add(isAnswerCorrect ? "ok" : "bad");

    fillNormalRow(currentSeq);
    showCurrentRoundCase();

    if (explainToggle.checked) {
      currentStrikeIdx = strikeIndexByRule(currentSeq);
      applyBlinkStrike(currentStrikeIdx);
    } 

    running = false;
    resetManualCycleState();
  }

  function resetModeStats () {
    const stats = getCurrentModeStats();
    stats.score = 0;
    stats.total = 0;
    stats.respSumMs = 0;
    stats.respCount = 0;
    saveStats();
    renderStats();
    cleanState();
    syncUI();
  }

  function cleanState() {
    stopBlink();
    clearFeedbackColors();
    showNextColor();
    setButtonsEnabled(false);
    resetTimer();

    awaitingAnswer = false;
    running = false;
    resetManualCycleState();
    singleSwatch.style.background = "rgba(255,255,255,0.00)";
  }

  function handleManualAnswerOrAdvance(ansIsOdd, sourceBtn) {
    if (awaitingAnswer) {
      submitAnswer(ansIsOdd, sourceBtn);
      return;
    }
    handleManualAdvanceIntent();
  }

  function handleManualAdvanceIntent() {
    if (!running && !awaitingAnswer) {
      startRoundManualInitial();
      return;
    }
    manualAdvanceFromInput();
  }


  // #endregion } 
  // ===== END Trainer Flow =====

  // ===== START Events Setup =====
  // #region Events 
  // { 
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

  function handleModeChange() {
    // debugger;
    if(mode === modeSelect.value) return;
    /* WIP 
    if(modeSelect.value === Modes.INSP) {
      alert("WIP - Feature not available yet");
      modeSelect.value = mode
      return;
    }
    /* WIP */
    mode = modeSelect.value;

    saveConfig();
    cleanState();
    syncUI();
  }

  modeSelect.addEventListener("change", () => {
    handleModeChange();
  });

  btnOdd.addEventListener("click", () => {
    switch(mode) {
      case Modes.AUTO: submitAnswer(true, btnOdd); break; 
      case Modes.MANU: handleManualAnswerOrAdvance(true, btnOdd); break;
      case Modes.INSP: submitInspectionAnswer(btnOdd); break;
    }
  });

  btnEven.addEventListener("click", () => {
    switch(mode) {
      case Modes.AUTO: submitAnswer(true, btnEven); break; 
      case Modes.MANU: handleManualAnswerOrAdvance(false, btnEven); break;
      case Modes.INSP: submitInspectionAnswer(btnEven); break;
    }
  });

  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("swatch")) {

      switch (mode) {
        case Modes.AUTO: startRoundAuto(); break;
        case Modes.MANU: handleManualAdvanceIntent(); break;
        case Modes.INSP: handleInspection(); break;
      }

    }
  });

  resetBtn.addEventListener("click", () => {
    resetModeStats();
  });

  window.addEventListener("keydown", (e) => {

    switch (mode) {
      // AUTO
      case Modes.AUTO:
        switch (e.code) {
          case "Space":
            e.preventDefault();
            startRoundAuto();
            break;
          case "ArrowLeft":
          case "KeyA":
            if (!btnOdd.disabled) {
              submitAnswer(true, btnOdd);
            } else if (!awaitingAnswer && !running) {
              e.preventDefault();
              startRoundAuto();
            }
            break;
          case "ArrowRight":
          case "KeyD":
            if (!btnEven.disabled) {
              submitAnswer(false, btnEven);
            } else if (!awaitingAnswer && !running) {
              e.preventDefault();
              startRoundAuto();
            }
            break;
        }
        break;
      // MANUAL
      case Modes.MANU:
        switch (e.code) {
          case "Space":
            e.preventDefault();
            handleManualAdvanceIntent();
            break;
          case "ArrowLeft":
          case "KeyA":
            e.preventDefault();
            handleManualAnswerOrAdvance(true, btnOdd);
            break;
          case "ArrowRight":
          case "KeyD":
            e.preventDefault();
            handleManualAnswerOrAdvance(false, btnEven);
            break;
        }
        break;
      // INSPECTION
      case Modes.INSP:
        switch (e.code) {
          case "Space":
            e.preventDefault();
            handleInspection();
            break;
          case "ArrowLeft":
          case "KeyA":
            e.preventDefault();
            submitInspectionAnswer(btnOdd);
            break;
          case "ArrowRight":
          case "KeyD":
            e.preventDefault();
            submitInspectionAnswer(btnEven);
            break;
        }
        break; 
    }
      
  }, { passive: false });

  document.addEventListener("touchstart", (e) => {
    if (mode === Modes.AUTO) return;
    if (document.body.classList.contains("modalOpen")) return;
    if (awaitingAnswer) return;

    const t = e.target;
    if (shouldIgnoreManualInputTarget(t)) return;

    e.preventDefault();
    handleManualAdvanceIntent();
  }, { passive: false });

  let lastTouchEnd = 0;

  document.addEventListener("touchend", (e) => {
    if (mode === Modes.AUTO) return;
    if (document.body.classList.contains("modalOpen")) return;

    const t = e.target;
    if (shouldIgnoreManualInputTarget(t)) return;

    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      e.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
  // #endregion } 
  // ===== END Events Setup =====


  // ===== TIMER ====== 

  let timerRunning = false 

  function startTimer() {
    responseStartMs = performance.now();
    lastPaint = 0;
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
    timerRunning = true; 
  }

  function stopTimer() {
    timerRunning = false; 
    cancelAnimationFrame(rafId);
    roundTimeMs = (performance.now() - responseStartMs);
    roundTimeSec = roundTimeMs / 1000;
    timerText.textContent = `${roundTimeSec.toFixed(2)}s`;
    responseStartMs = null;
  }

  function tick(now) {

    if (!timerRunning) return;

    if (now - lastPaint >= UPDATE_EVERY_MS) {
      lastPaint = now;
      const elapsed = (now - responseStartMs) / 1000;
      if(elapsed>= 0) timerText.textContent = `${elapsed.toFixed(2)}s`;
    }

    rafId = requestAnimationFrame(tick);
  }

  function resetTimer() {
    timerRunning = false; 
    responseStartMs = null
    timerText.textContent = "0.00s";
    roundTimeMs = 0
    roundTimeSec = 0
  }




  // --------------
  // --- SETUP ----
  // --------------

  loadStats();
  loadConfig();

  msRange.value = String(ms);
  msVal.textContent = String(ms);

  // switch UIs
  syncExplainUI();
  syncUI();

  renderStats();
  showNextColor();
  singleSwatch.style.background = "rgba(255,255,255,0.00)";
  setButtonsEnabled(false);

})();
