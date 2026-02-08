// Ukrainian alphabet (skip Ґ and Ь)
const ALPHABET = [
  'А','Б','В','Г','Д','Е','Є','Ж','З',
  'І','Ї','Й','К','Л','М','Н','О','П',
  'Р','С','Т','У','Ф','Х','Ц','Ч','Ш','Щ',
  'Ю','Я'
];

// --- State ---
let stats = loadStats();
let currentQuestion = null; // { letterIndex, correctAnswer }
let answered = false;
let sessionCorrect = 0;
let sessionWrong = 0;
let showOptions = localStorage.getItem('alphabet-mode') === 'options';
let questionStartTime = 0;
let streak = 0;
let recordStreak = parseInt(localStorage.getItem('alphabet-record-streak') || '0', 10);
let countdownTimer = null;
const TIMER_DURATION = 3000;

// --- DOM refs ---
const currentLetterEl = document.getElementById('current-letter');
const optionsEl = document.getElementById('options');
const feedbackEl = document.getElementById('feedback');
const nextBtn = document.getElementById('next-btn');
const customInput = document.getElementById('custom-input');
const customSubmit = document.getElementById('custom-submit');
const sessionCorrectEl = document.getElementById('session-correct');
const sessionWrongEl = document.getElementById('session-wrong');

const streakCountEl = document.getElementById('streak-count');
const streakRecordEl = document.getElementById('streak-record');
const timerBarContainer = document.getElementById('timer-bar-container');
const timerBar = document.getElementById('timer-bar');

const quizView = document.getElementById('quiz-view');
const statsView = document.getElementById('stats-view');
const btnQuiz = document.getElementById('btn-quiz');
const btnStats = document.getElementById('btn-stats');
const resetStatsBtn = document.getElementById('reset-stats');
const toggleModeBtn = document.getElementById('toggle-mode');
const inputArea = document.querySelector('.input-area');

// --- Stats persistence ---
function loadStats() {
  try {
    const saved = localStorage.getItem('alphabet-stats');
    if (saved) return JSON.parse(saved);
  } catch {}
  return {};
}

function saveStats() {
  localStorage.setItem('alphabet-stats', JSON.stringify(stats));
}

function getLetterStats(letter) {
  if (!stats[letter]) {
    stats[letter] = { shown: 0, correct: 0, wrong: 0, totalTime: 0, timedCorrect: 0 };
  }
  // Migrate old stats missing time fields
  const s = stats[letter];
  if (s.totalTime === undefined) { s.totalTime = 0; s.timedCorrect = 0; }
  return s;
}

// --- Prioritization ---
// Pick the next letter to quiz on.
// Higher priority for: letters with more mistakes, then less-shown letters.
function pickQuestion() {
  // We can ask about letters 0..31 (А..Ю), answer is the next letter
  const candidates = [];

  for (let i = 0; i < ALPHABET.length - 1; i++) {
    const letter = ALPHABET[i];
    const s = getLetterStats(letter);

    // Error rate: fraction of wrong answers (high = more mistakes)
    // If never shown, treat as high error rate to ensure exploration
    const errorRate = s.shown > 0 ? s.wrong / s.shown : 1.0;

    // Exploration bonus: prefer less-shown letters (decays as shown increases)
    const explorationBonus = 1 / (s.shown + 1);

    // Hesitation factor: slow correct answers still need practice
    // Scale: <1s → ~0.2 (confident), 3s+ → 1.0 (hesitant), no data → 1.0
    let hesitation = 1.0;
    if (s.timedCorrect > 0) {
      const avgMs = s.totalTime / s.timedCorrect;
      hesitation = Math.min(avgMs / 3000, 1.0);
    }

    // Combined: errors dominate, then hesitation, then exploration
    const priority = errorRate * 3 + hesitation * 2 + explorationBonus;

    candidates.push({ index: i, priority });
  }

  // Weighted random selection based on priority
  const totalWeight = candidates.reduce((sum, c) => sum + c.priority, 0);
  let rand = Math.random() * totalWeight;

  for (const c of candidates) {
    rand -= c.priority;
    if (rand <= 0) {
      return c.index;
    }
  }

  // Fallback
  return candidates[candidates.length - 1].index;
}

// --- Generate wrong answers ---
function generateOptions(correctIndex) {
  const correctLetter = ALPHABET[correctIndex];
  const wrongPool = ALPHABET.filter((_, i) => i !== correctIndex);

  // Shuffle and pick 3
  for (let i = wrongPool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wrongPool[i], wrongPool[j]] = [wrongPool[j], wrongPool[i]];
  }
  const wrong = wrongPool.slice(0, 3);

  // Combine and shuffle
  const options = [correctLetter, ...wrong];
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  return options;
}

// --- Mode toggle ---
function applyMode() {
  if (showOptions) {
    optionsEl.classList.remove('hidden');
    toggleModeBtn.textContent = 'Сховати варіанти';
  } else {
    optionsEl.classList.add('hidden');
    toggleModeBtn.textContent = 'Показати варіанти';
  }
}

toggleModeBtn.addEventListener('click', () => {
  showOptions = !showOptions;
  localStorage.setItem('alphabet-mode', showOptions ? 'options' : 'input');
  applyMode();
  // Restart or stop the timer when switching modes mid-question
  if (!answered) startTimer();
});

// --- Streak ---
function updateStreakDisplay() {
  streakCountEl.textContent = streak;
  streakRecordEl.textContent = recordStreak;
}

function resetStreak() {
  streak = 0;
  updateStreakDisplay();
}

function incrementStreak() {
  streak++;
  if (streak > recordStreak) {
    recordStreak = streak;
    localStorage.setItem('alphabet-record-streak', String(recordStreak));
  }
  updateStreakDisplay();
}

// --- Countdown timer (options mode only) ---
function stopTimer() {
  if (countdownTimer) {
    clearTimeout(countdownTimer);
    countdownTimer = null;
  }
  timerBar.style.animation = 'none';
  timerBarContainer.classList.add('hidden');
}

function startTimer() {
  stopTimer();
  if (!showOptions) return;

  timerBarContainer.classList.remove('hidden');
  // Trigger reflow so animation restarts
  void timerBar.offsetWidth;
  timerBar.style.animation = `timer-shrink ${TIMER_DURATION}ms linear forwards`;

  countdownTimer = setTimeout(() => {
    countdownTimer = null;
    handleTimeout();
  }, TIMER_DURATION);
}

function handleTimeout() {
  if (answered) return;
  answered = true;
  stopTimer();

  const letter = ALPHABET[currentQuestion.letterIndex];
  const correct = currentQuestion.correctAnswer;

  // Record as wrong
  const s = getLetterStats(letter);
  s.shown++;
  s.wrong++;
  sessionWrong++;
  saveStats();

  sessionCorrectEl.textContent = sessionCorrect;
  sessionWrongEl.textContent = sessionWrong;

  resetStreak();

  // Disable all buttons
  customInput.disabled = true;
  customSubmit.disabled = true;
  const allBtns = optionsEl.querySelectorAll('.option-btn');
  for (const btn of allBtns) {
    btn.disabled = true;
    if (btn.textContent === correct) {
      btn.classList.add('correct');
    }
  }

  feedbackEl.textContent = `Час вийшов! Після ${letter} йде ${correct}`;
  feedbackEl.className = 'feedback wrong';
  feedbackEl.classList.remove('hidden');
  nextBtn.classList.remove('hidden');
  nextBtn.focus();
}

// --- Render question ---
function showQuestion() {
  answered = false;
  feedbackEl.classList.add('hidden');
  nextBtn.classList.add('hidden');
  customInput.value = '';
  customInput.disabled = false;
  customSubmit.disabled = false;

  const qi = pickQuestion();
  const correctIndex = qi + 1;
  currentQuestion = { letterIndex: qi, correctAnswer: ALPHABET[correctIndex] };

  currentLetterEl.textContent = ALPHABET[qi];
  currentLetterEl.className = 'big-letter';

  const options = generateOptions(correctIndex);
  optionsEl.innerHTML = '';

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.textContent = opt;
    btn.addEventListener('click', () => handleAnswer(opt, btn));
    optionsEl.appendChild(btn);
  }

  applyMode();
  customInput.focus();
  questionStartTime = performance.now();
  startTimer();
}

// --- Handle answer ---
function handleAnswer(answer, clickedBtn) {
  if (answered) return;
  answered = true;
  stopTimer();

  const letter = ALPHABET[currentQuestion.letterIndex];
  const correct = currentQuestion.correctAnswer;
  const isCorrect = answer.toUpperCase() === correct;

  // Update stats
  const reactionMs = Math.round(performance.now() - questionStartTime);
  const s = getLetterStats(letter);
  s.shown++;
  if (isCorrect) {
    s.correct++;
    s.totalTime += reactionMs;
    s.timedCorrect++;
    sessionCorrect++;
    incrementStreak();
  } else {
    s.wrong++;
    sessionWrong++;
    resetStreak();
  }
  saveStats();

  // Update session display
  sessionCorrectEl.textContent = sessionCorrect;
  sessionWrongEl.textContent = sessionWrong;

  // Correct → skip straight to next question
  if (isCorrect) {
    showQuestion();
    return;
  }

  // Wrong → show feedback and wait
  customInput.disabled = true;
  customSubmit.disabled = true;

  const allBtns = optionsEl.querySelectorAll('.option-btn');
  for (const btn of allBtns) {
    btn.disabled = true;
    if (btn.textContent === correct) {
      btn.classList.add('correct');
    }
    if (btn === clickedBtn) {
      btn.classList.add('wrong');
    }
  }

  feedbackEl.textContent = `Неправильно. Після ${letter} йде ${correct}`;
  feedbackEl.className = 'feedback wrong';
  feedbackEl.classList.remove('hidden');
  nextBtn.classList.remove('hidden');
  nextBtn.focus();
}

// --- Custom input ---
function handleCustomInput() {
  const val = customInput.value.trim().toUpperCase();
  if (!val || answered) return;

  // Validate it's a Ukrainian letter
  if (!ALPHABET.includes(val)) {
    customInput.classList.add('shake');
    setTimeout(() => customInput.classList.remove('shake'), 400);
    return;
  }

  handleAnswer(val, null);

  // Also highlight the matching button if exists
  const allBtns = optionsEl.querySelectorAll('.option-btn');
  for (const btn of allBtns) {
    if (btn.textContent === val && val !== currentQuestion.correctAnswer) {
      btn.classList.add('wrong');
    }
  }
}

customSubmit.addEventListener('click', handleCustomInput);
customInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleCustomInput();
});

// --- Next button ---
nextBtn.addEventListener('click', showQuestion);

// --- Keyboard shortcut: press any key to go next after answering ---
document.addEventListener('keydown', (e) => {
  if (answered && !nextBtn.classList.contains('hidden') && e.key !== 'Tab') {
    // If user is typing in input, ignore
    if (document.activeElement === customInput) return;
    showQuestion();
  }
});

// --- Navigation ---
btnQuiz.addEventListener('click', () => {
  quizView.classList.remove('hidden');
  statsView.classList.add('hidden');
  btnQuiz.classList.add('active');
  btnStats.classList.remove('active');
});

btnStats.addEventListener('click', () => {
  quizView.classList.add('hidden');
  statsView.classList.remove('hidden');
  btnQuiz.classList.remove('active');
  btnStats.classList.add('active');
  renderStats();
});

// --- Stats view ---
function renderStats() {
  const tbody = document.getElementById('stats-body');
  tbody.innerHTML = '';

  let totalShown = 0;
  let totalCorrect = 0;

  const rows = [];

  for (let i = 0; i < ALPHABET.length - 1; i++) {
    const letter = ALPHABET[i];
    const nextLetter = ALPHABET[i + 1];
    const s = getLetterStats(letter);
    totalShown += s.shown;
    totalCorrect += s.correct;

    const accuracy = s.shown > 0 ? Math.round((s.correct / s.shown) * 100) : null;
    const avgTime = s.timedCorrect > 0 ? s.totalTime / s.timedCorrect : null;

    rows.push({ letter, nextLetter, s, accuracy, avgTime });
  }

  // Sort: worst accuracy first, then least shown
  rows.sort((a, b) => {
    const accA = a.accuracy !== null ? a.accuracy : -1;
    const accB = b.accuracy !== null ? b.accuracy : -1;
    if (accA !== accB) return accA - accB;
    return a.s.shown - b.s.shown;
  });

  for (const row of rows) {
    const tr = document.createElement('tr');
    const accuracyText = row.accuracy !== null ? `${row.accuracy}%` : '—';

    let accuracyClass = '';
    if (row.accuracy !== null) {
      if (row.accuracy >= 80) accuracyClass = 'good';
      else if (row.accuracy >= 50) accuracyClass = 'ok';
      else accuracyClass = 'bad';
    }

    const timeText = row.avgTime !== null ? `${(row.avgTime / 1000).toFixed(1)}с` : '—';
    let timeClass = '';
    if (row.avgTime !== null) {
      if (row.avgTime <= 1500) timeClass = 'good';
      else if (row.avgTime <= 3000) timeClass = 'ok';
      else timeClass = 'bad';
    }

    tr.innerHTML = `
      <td class="letter-cell">${row.letter}</td>
      <td class="letter-cell">${row.nextLetter}</td>
      <td>${row.s.shown}</td>
      <td>${row.s.correct}</td>
      <td class="${accuracyClass}">${accuracyText}</td>
      <td class="${timeClass}">${timeText}</td>
    `;
    tbody.appendChild(tr);
  }

  // Summary
  document.getElementById('total-answered').textContent = totalShown;
  const overallAcc = totalShown > 0 ? Math.round((totalCorrect / totalShown) * 100) : 0;
  document.getElementById('total-accuracy').textContent = `${overallAcc}%`;
}

// --- Reset stats ---
resetStatsBtn.addEventListener('click', () => {
  if (confirm('Скинути всю статистику?')) {
    stats = {};
    saveStats();
    sessionCorrect = 0;
    sessionWrong = 0;
    sessionCorrectEl.textContent = '0';
    sessionWrongEl.textContent = '0';
    streak = 0;
    recordStreak = 0;
    localStorage.setItem('alphabet-record-streak', '0');
    updateStreakDisplay();
    renderStats();
  }
});

// --- Init ---
updateStreakDisplay();
showQuestion();
