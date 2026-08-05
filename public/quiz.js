// === CONFIGURATION ===
const API_BASE = '';
const DB_NAME = 'crossword-quiz-offline';
const DB_VERSION = 1;
const TOP_CANDIDATES_COUNT = 5;
const SESSION_SIZE = 20;
const SESSION_CORRECT_REQUIRED = 3;
const SESSION_SPACING = 10;
// A clue attempted within this window is excluded from a fresh session's
// candidate pool, so consecutive sessions don't re-serve just-drilled clues.
// Relaxed automatically if too few fresh clues remain to fill a session.
const SESSION_COOLDOWN_MS = 45 * 60 * 1000; // 45 minutes

// === STATE ===
let currentClue = null;
let currentSessionClue = null;
let activeSession = null;
let submitted = false;
let hintUsed = false;
let hintCheckedLetters = []; // Track which letters have been checked via hint
let hintsUsedThisClue = 0; // Track hints used on current clue
let sessionStats = { correct: 0, total: 0 };
let currentStreak = 0;
let longestStreak = parseInt(localStorage.getItem('longestStreak') || '0');
let includeCompleted = false;
let isOnline = navigator.onLine;
let db = null;
let syncInProgress = false;
let autoAdvanceTimeout = null;
let autoAdvancePaused = false;

// === INDEXEDDB ===
function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // Store for clues
      if (!database.objectStoreNames.contains('clues')) {
        const clueStore = database.createObjectStore('clues', { keyPath: 'key' });
        clueStore.createIndex('puzzleDate', 'puzzleDate', { unique: false });
      }

      // Store for attempts
      if (!database.objectStoreNames.contains('attempts')) {
        database.createObjectStore('attempts', { keyPath: 'key' });
      }

      // Store for pending attempts (to sync later)
      if (!database.objectStoreNames.contains('pendingAttempts')) {
        const pendingStore = database.createObjectStore('pendingAttempts', { keyPath: 'id', autoIncrement: true });
        pendingStore.createIndex('clueKey', 'clueKey', { unique: false });
      }

      // Store for sync metadata
      if (!database.objectStoreNames.contains('syncMeta')) {
        database.createObjectStore('syncMeta', { keyPath: 'key' });
      }
    };
  });
}

function dbTransaction(storeNames, mode = 'readonly') {
  return db.transaction(storeNames, mode);
}

// Union two attempt arrays by timestamp, keeping order. Attempts are
// append-only, so a union never loses a locally-recorded attempt that the
// server snapshot hasn't caught up with yet. Pure so it can be unit-tested.
function mergeAttempts(existing, incoming) {
  const byTs = new Map();
  for (const a of existing || []) byTs.set(a.timestamp, a);
  for (const a of incoming || []) if (!byTs.has(a.timestamp)) byTs.set(a.timestamp, a);
  return Array.from(byTs.values()).sort((x, y) => x.timestamp - y.timestamp);
}

async function saveClues(clues, clearFirst = false) {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction(['clues', 'attempts'], 'readwrite');
    const clueStore = tx.objectStore('clues');
    const attemptStore = tx.objectStore('attempts');

    // Clear existing clues if requested (for full sync). We deliberately do NOT
    // clear the attempts store: a full sync must never drop a locally-recorded
    // attempt the server hasn't seen yet (e.g. a still-pending POST).
    if (clearFirst) {
      clueStore.clear();
    }

    for (const clue of clues) {
      const key = `${clue.puzzleDate}:${clue.direction}-${clue.number}`;
      clueStore.put({
        key,
        puzzleDate: clue.puzzleDate,
        direction: clue.direction,
        number: clue.number,
        text: clue.text,
        pattern: clue.pattern,
        answer: clue.answer,
        hintsAvailable: clue.hintsAvailable,
        puzzleComplete: clue.puzzleComplete || false
      });

      // Merge server attempts with any local attempts rather than overwriting,
      // so a full sync can never roll back local attempt history.
      const incoming = clue.attempts || [];
      const getReq = attemptStore.get(key);
      getReq.onsuccess = () => {
        const existing = getReq.result?.attempts || [];
        attemptStore.put({ key, attempts: mergeAttempts(existing, incoming) });
      };
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllClues() {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction('clues');
    const store = tx.objectStore('clues');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAttempts(clueKey) {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction('attempts');
    const store = tx.objectStore('attempts');
    const request = store.get(clueKey);

    request.onsuccess = () => resolve(request.result?.attempts || []);
    request.onerror = () => reject(request.error);
  });
}

async function getAllAttempts() {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction('attempts');
    const store = tx.objectStore('attempts');
    const request = store.getAll();

    request.onsuccess = () => {
      const map = {};
      for (const record of request.result) {
        map[record.key] = record.attempts || [];
      }
      resolve(map);
    };
    request.onerror = () => reject(request.error);
  });
}

async function saveLocalAttempt(clueKey, attempt) {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction('attempts', 'readwrite');
    const store = tx.objectStore('attempts');
    const request = store.get(clueKey);

    request.onsuccess = () => {
      const record = request.result || { key: clueKey, attempts: [] };
      record.attempts.push(attempt);
      store.put(record);
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function queuePendingAttempt(clueKey, timestamp, correct) {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction('pendingAttempts', 'readwrite');
    const store = tx.objectStore('pendingAttempts');
    store.add({ clueKey, timestamp, correct });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getPendingAttempts() {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction('pendingAttempts');
    const store = tx.objectStore('pendingAttempts');
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function removePendingAttempt(id) {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction('pendingAttempts', 'readwrite');
    const store = tx.objectStore('pendingAttempts');
    store.delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getSyncMeta() {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction('syncMeta');
    const store = tx.objectStore('syncMeta');
    const request = store.get('lastSync');

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setSyncMeta(meta) {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction('syncMeta', 'readwrite');
    const store = tx.objectStore('syncMeta');
    store.put({ key: 'lastSync', ...meta });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// === SPACED REPETITION ALGORITHM ===
// (Ported from api/quiz.js)

function calculateWilsonLower(successes, total) {
  if (total === 0) return 0;

  const z = 1.96; // 95% confidence
  const p = successes / total;
  const z2 = z * z;
  const n = total;

  const numerator = p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  const denominator = 1 + z2 / n;

  return numerator / denominator;
}

function calculateMinInterval(wilsonLower, total) {
  if (total === 0) return 0;

  // Kept in sync with lib/spaced-repetition.js calculateMinInterval.
  const baseMinutes = 5;
  const maxMinutes = 480; // 8 hours at high Wilson

  const scaleFactor = Math.pow(wilsonLower, 2) * maxMinutes + baseMinutes;
  const attemptBonus = Math.min(total / 10, 1);
  const adjustedMinutes = scaleFactor * (1 + attemptBonus * (0.5 + wilsonLower));

  return adjustedMinutes * 60 * 1000; // Convert to milliseconds
}

function calculatePriority(wilsonLower, total, lastAttemptTime, now) {
  if (total === 0) return -1000; // Never attempted - highest priority

  const minInterval = calculateMinInterval(wilsonLower, total);
  const timeSinceLastAttempt = now - lastAttemptTime;

  if (timeSinceLastAttempt < minInterval) {
    const remainingRatio = (minInterval - timeSinceLastAttempt) / minInterval;
    return 1000 + remainingRatio * 1000;
  }

  const overdueRatio = timeSinceLastAttempt / minInterval;
  const overduePenalty = Math.min(overdueRatio - 1, 5) * 0.1;

  return wilsonLower - overduePenalty;
}

// === CLUE SELECTION ===
async function selectNextClue() {
  const allClues = await getAllClues();
  if (allClues.length === 0) return null;

  // Filter out clues from completed puzzles unless includeCompleted is true
  const eligibleClues = includeCompleted
    ? allClues
    : allClues.filter(clue => !clue.puzzleComplete);

  if (eligibleClues.length === 0) return null;

  const now = Date.now();
  const cluesWithScores = [];

  for (const clue of eligibleClues) {
    const attempts = await getAttempts(clue.key);
    const total = attempts.length;
    const correct = attempts.filter(a => a.correct).length;
    const wilsonLower = calculateWilsonLower(correct, total);
    const lastAttemptTime = total > 0 ? Math.max(...attempts.map(a => a.timestamp)) : 0;
    const priority = calculatePriority(wilsonLower, total, lastAttemptTime, now);

    cluesWithScores.push({
      ...clue,
      total,
      correct,
      wilsonLower,
      priority,
      lastAttemptTime
    });
  }

  // Sort by priority (ascending)
  cluesWithScores.sort((a, b) => {
    const diff = a.priority - b.priority;
    if (Math.abs(diff) < 0.1) return Math.random() - 0.5;
    return diff;
  });

  // Weighted selection from top candidates
  const topCount = Math.min(TOP_CANDIDATES_COUNT, cluesWithScores.length);
  const weights = [];
  for (let i = 0; i < topCount; i++) {
    weights.push(topCount - i);
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalWeight;
  let selectedIndex = 0;
  for (let i = 0; i < topCount; i++) {
    rand -= weights[i];
    if (rand <= 0) {
      selectedIndex = i;
      break;
    }
  }

  return cluesWithScores[selectedIndex];
}

// === SESSION MODE ===

// Order candidates so distinct puzzles are surfaced first, then second-best
// clue per puzzle, and so on. `scored` must already be sorted by priority
// (best first). This "round-robin by puzzle layer" keeps a single session
// varied across puzzles while still making deeper clues from the same puzzles
// available to fill a session when few puzzles are active.
function orderByPuzzleLayers(scored) {
  const byPuzzle = new Map();
  for (const item of scored) {
    const date = item.clue.puzzleDate;
    if (!byPuzzle.has(date)) byPuzzle.set(date, []);
    byPuzzle.get(date).push(item); // preserves priority order
  }
  const groups = Array.from(byPuzzle.values());
  const ordered = [];
  let layer = 0;
  let added = true;
  while (added) {
    added = false;
    const layerItems = [];
    for (const g of groups) {
      if (layer < g.length) { layerItems.push(g[layer]); added = true; }
    }
    layerItems.sort((a, b) => a.priority - b.priority);
    ordered.push(...layerItems);
    layer++;
  }
  return ordered;
}

// Build a session from scored, priority-sorted candidates. Each item is
// { clue, priority, lastAttemptTime }. Prefers clues not attempted within
// cooldownMs, prefers distinct puzzles within a session, and only reuses a
// puzzle (or a cooled-down clue) when there aren't enough fresh distinct
// clues to fill the session. Pure so it can be unit-tested.
function selectSessionClues(scored, sessionSize, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const cooldownMs = opts.cooldownMs || 0;
  const rand = opts.random || Math.random;

  const isFresh = it =>
    !cooldownMs || !it.lastAttemptTime || (now - it.lastAttemptTime) >= cooldownMs;

  // Fresh clues first, cooled-down clues only as fallback to fill a session.
  const fresh = scored.filter(isFresh);
  const stale = scored.filter(it => !isFresh(it));
  const ordered = orderByPuzzleLayers(fresh).concat(orderByPuzzleLayers(stale));

  const poolSize = Math.min(sessionSize * 3, ordered.length);
  const pool = ordered.slice(0, poolSize);
  const weights = pool.map((_, i) => Math.max(1, poolSize - i));

  const remaining = pool.slice();
  const remainingWeights = weights.slice();
  const selected = [];
  const usedPuzzles = new Set();
  const count = Math.min(sessionSize, ordered.length);

  while (selected.length < count && remaining.length > 0) {
    // Prefer candidates from puzzles not yet used in this pass. Once every
    // remaining puzzle is represented, start a fresh pass so extra clues are
    // spread evenly across puzzles (round-robin) rather than piling onto one.
    let candidateIdx = [];
    for (let i = 0; i < remaining.length; i++) {
      if (!usedPuzzles.has(remaining[i].clue.puzzleDate)) candidateIdx.push(i);
    }
    if (candidateIdx.length === 0) {
      usedPuzzles.clear();
      candidateIdx = remaining.map((_, i) => i);
    }

    const totalW = candidateIdx.reduce((s, i) => s + remainingWeights[i], 0);
    let r = rand() * totalW;
    let pick = candidateIdx[candidateIdx.length - 1];
    for (const i of candidateIdx) {
      r -= remainingWeights[i];
      if (r <= 0) { pick = i; break; }
    }

    selected.push(remaining[pick].clue);
    usedPuzzles.add(remaining[pick].clue.puzzleDate);
    remaining.splice(pick, 1);
    remainingWeights.splice(pick, 1);
  }

  return selected;
}

async function initSession() {
  const [allClues, attemptsMap] = await Promise.all([getAllClues(), getAllAttempts()]);

  const eligible = includeCompleted
    ? allClues
    : allClues.filter(c => !c.puzzleComplete);

  if (eligible.length === 0) {
    activeSession = null;
    sessionStorage.removeItem('quiz-session');
    return;
  }

  const now = Date.now();
  const scored = eligible.map(clue => {
    const attempts = attemptsMap[clue.key] || [];
    const total = attempts.length;
    const correct = attempts.filter(a => a.correct).length;
    const wilsonLower = calculateWilsonLower(correct, total);
    const lastAttemptTime = total > 0 ? Math.max(...attempts.map(a => a.timestamp)) : 0;
    const priority = calculatePriority(wilsonLower, total, lastAttemptTime, now);
    return { clue, priority, lastAttemptTime };
  });

  scored.sort((a, b) => a.priority - b.priority);

  const selected = selectSessionClues(scored, SESSION_SIZE, {
    now,
    cooldownMs: SESSION_COOLDOWN_MS
  });

  activeSession = {
    sessionClues: selected.map(clue => ({
      clue,
      correctCount: 0,
      nextEligibleAt: 0,
      retired: false
    })),
    totalAttempts: 0,
    startedAt: Date.now()
  };

  saveSession();
}

function saveSession() {
  if (!activeSession) {
    sessionStorage.removeItem('quiz-session');
    return;
  }
  sessionStorage.setItem('quiz-session', JSON.stringify(activeSession));
}

function restoreSession() {
  const raw = sessionStorage.getItem('quiz-session');
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.sessionClues)) return false;
    if (!parsed.sessionClues.some(sc => !sc.retired)) return false;
    activeSession = parsed;
    return true;
  } catch (e) {
    sessionStorage.removeItem('quiz-session');
    return false;
  }
}

function selectNextSessionClue() {
  if (!activeSession) return null;

  const { sessionClues, totalAttempts } = activeSession;
  const unretired = sessionClues.filter(sc => !sc.retired);
  if (unretired.length === 0) return null;

  const eligible = unretired.filter(sc => sc.nextEligibleAt <= totalAttempts);
  const pool = eligible.length > 0 ? eligible : unretired;

  if (eligible.length === 0) {
    // Spacing can't be honored — pick whichever is soonest eligible
    return pool.reduce((a, b) => a.nextEligibleAt < b.nextEligibleAt ? a : b);
  }

  // Among eligible, prefer those with fewer session correct answers; break ties randomly
  pool.sort((a, b) => {
    const diff = a.correctCount - b.correctCount;
    return diff !== 0 ? diff : Math.random() - 0.5;
  });

  return pool[0];
}

function recordSessionAttempt(sessionClue, allCorrect) {
  if (!activeSession || !sessionClue) return;

  activeSession.totalAttempts++;

  if (allCorrect) {
    sessionClue.correctCount++;
    sessionClue.nextEligibleAt = activeSession.totalAttempts + SESSION_SPACING;
    if (sessionClue.correctCount >= SESSION_CORRECT_REQUIRED) {
      sessionClue.retired = true;
    }
  } else {
    sessionClue.nextEligibleAt = activeSession.totalAttempts + 2;
  }

  saveSession();
}

function showSessionComplete() {
  const startedAt = activeSession ? activeSession.startedAt : Date.now();
  const clueCount = activeSession ? activeSession.sessionClues.length : SESSION_SIZE;
  const totalAttempts = activeSession ? activeSession.totalAttempts : 0;

  activeSession = null;
  currentSessionClue = null;
  saveSession();

  const elapsedMs = Date.now() - startedAt;
  const mins = Math.floor(elapsedMs / 60000);
  const secs = Math.floor((elapsedMs % 60000) / 1000);
  const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const container = document.getElementById('quiz');
  container.innerHTML = `
    <div class="session-complete-screen">
      <div class="session-complete-title">Session Complete</div>
      <div class="session-complete-detail">All ${clueCount} clues retired in ${totalAttempts} attempts</div>
      <div class="session-complete-time">Time: ${timeStr}</div>
      <button class="next-btn" onclick="startNewSession()">Start New Session</button>
    </div>
  `;
}

async function startNewSession() {
  document.getElementById('quiz').innerHTML = '<div class="loading">Building session...</div>';
  // Pull fresh clue eligibility before selecting so a new session never includes
  // clues that were ignored or deleted on the server.
  if (isOnline) await syncFromServer(true);
  await initSession();
  await loadClue();
}

// Given the session clues and the set of clue keys that still exist locally,
// return the session clues that are still valid. Pure helper for testability.
function reconcileSessionClues(sessionClues, validKeys) {
  return sessionClues.filter(sc => validKeys.has(sc.clue.key));
}

// Drop any clues from the active session whose local record has disappeared
// (e.g. a full sync pruned a clue that was ignored on the server). If the
// currently displayed clue was removed, advance to the next one.
async function reconcileActiveSession() {
  if (!activeSession) return;

  const clues = await getAllClues();
  const validKeys = new Set(clues.map(c => c.key));
  const before = activeSession.sessionClues.length;
  activeSession.sessionClues = reconcileSessionClues(activeSession.sessionClues, validKeys);

  if (activeSession.sessionClues.length === before) return;

  const currentRemoved = currentSessionClue && !validKeys.has(currentSessionClue.clue.key);

  if (!activeSession.sessionClues.some(sc => !sc.retired)) {
    // Nothing selectable remains — end the session cleanly.
    activeSession = null;
    currentSessionClue = null;
    saveSession();
    return;
  }

  saveSession();

  if (currentRemoved) {
    currentSessionClue = null;
    loadClue();
  }
}

// === OFFLINE SYNC LOGIC ===
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // Only sync if data is older than 5 minutes
// How stale full-clue data may get before we do a full (not incremental) sync.
// Incremental syncs only carry new attempts — they never remove clues that were
// ignored or deleted on the server, so a periodic full sync is what prunes them.
const FULL_SYNC_INTERVAL_MS = 5 * 60 * 1000;

// Decide whether a sync should be skipped, and if not, whether it should be a
// full sync (clears and replaces the local clue store, pruning ignored/removed
// clues) or an incremental sync (fetches only new attempts).
// Pure function so it can be unit-tested independently of the browser runtime.
function decideSyncStrategy({ force, sameMode, lastSync, lastFullSync, now,
  syncIntervalMs = SYNC_INTERVAL_MS, fullSyncIntervalMs = FULL_SYNC_INTERVAL_MS }) {
  // Skip entirely if we synced recently in the same mode (unless forced).
  if (!force && sameMode && (now - lastSync) < syncIntervalMs) {
    return { skip: true, useIncremental: false };
  }

  // A full sync is required when forced, when the mode changed, when we've never
  // done a full sync, or when the full-clue data has gone stale.
  const fullSyncDue = force || !sameMode || lastFullSync === 0
    || (now - lastFullSync) >= fullSyncIntervalMs;

  return { skip: false, useIncremental: !fullSyncDue && lastSync > 0 };
}

async function mergeNewAttempts(newAttempts) {
  // Merge new attempts from server into local IndexedDB
  for (const { clueKey, attempts } of newAttempts) {
    const existing = await getAttempts(clueKey);
    const existingTimestamps = new Set(existing.map(a => a.timestamp));

    // Add only attempts we don't already have
    const toAdd = attempts.filter(a => !existingTimestamps.has(a.timestamp));
    for (const attempt of toAdd) {
      await saveLocalAttempt(clueKey, attempt);
    }
  }
}

async function syncFromServer(force = false) {
  if (!isOnline) return false;

  try {
    // Check if we need to sync
    const meta = await getSyncMeta();
    const now = Date.now();
    const lastSync = meta?.timestamp || 0;
    const lastFullSync = meta?.fullTimestamp || 0;
    const sameMode = meta?.includeCompleted === includeCompleted;

    const { skip, useIncremental } = decideSyncStrategy({
      force, sameMode, lastSync, lastFullSync, now
    });

    // Skip sync if recent and same mode (unless forced)
    if (skip) {
      console.log('Skipping sync - data is fresh');
      return true;
    }

    updateStatusIndicator('syncing');

    let url = includeCompleted
      ? `${API_BASE}/api/quiz-bulk?includeCompleted=true`
      : `${API_BASE}/api/quiz-bulk`;

    if (useIncremental) {
      url += `${url.includes('?') ? '&' : '?'}since=${lastSync}`;
    }

    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch');

    const data = await res.json();

    if (data.isIncremental) {
      // Incremental: merge new clues and attempts. Preserve the last full-sync
      // timestamp so full syncs keep recurring on their own schedule.
      if (data.clues.length > 0) {
        await saveClues(data.clues);
      }
      if (data.newAttempts.length > 0) {
        await mergeNewAttempts(data.newAttempts);
      }
      console.log(`Incremental sync: ${data.clues.length} clues, ${data.newAttempts.length} attempt updates`);
      await setSyncMeta({ timestamp: data.fetchedAt, fullTimestamp: lastFullSync, includeCompleted });
    } else {
      // Full sync: clear and replace everything. This drops clues that were
      // ignored or deleted on the server since the last full sync.
      await saveClues(data.clues, true);
      console.log(`Full sync: ${data.clues.length} clues (cleared old data)`);
      await setSyncMeta({ timestamp: data.fetchedAt, fullTimestamp: data.fetchedAt, includeCompleted });
      // Drop any in-progress session clues that no longer exist locally.
      await reconcileActiveSession();
    }

    updateStatusIndicator('online');
    return true;
  } catch (err) {
    console.error('Sync from server failed:', err);
    updateStatusIndicator(isOnline ? 'online' : 'offline');
    return false;
  }
}

async function syncPendingAttempts() {
  if (!isOnline || syncInProgress) return;
  syncInProgress = true;

  try {
    const pending = await getPendingAttempts();
    if (pending.length === 0) {
      syncInProgress = false;
      return;
    }

    updateStatusIndicator('syncing');

    for (const attempt of pending) {
      const [puzzleDate, clueId] = attempt.clueKey.split(':');

      try {
        await fetch(`${API_BASE}/api/quiz-attempt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clueId, puzzleDate, correct: attempt.correct })
        });
        await removePendingAttempt(attempt.id);
      } catch (err) {
        console.error('Failed to sync attempt:', err);
        break; // Stop on first failure, will retry later
      }
    }

    updateStatusIndicator('online');
  } finally {
    syncInProgress = false;
  }
}

async function recordAttempt(clueKey, correct, answerLength = 0, hintsUsed = 0, allCorrect = false) {
  const timestamp = Date.now();

  // Always save locally
  await saveLocalAttempt(clueKey, { timestamp, correct });

  if (isOnline) {
    try {
      const [puzzleDate, clueId] = clueKey.split(':');
      const res = await fetch(`${API_BASE}/api/quiz-attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clueId, puzzleDate, correct, answerLength, hintsUsed, allCorrect })
      });

      if (res.ok) {
        const data = await res.json();
        // Update local hintsAvailable from server response
        if (data.hintsAvailable !== undefined) {
          await updateClueHints(clueKey, data.hintsAvailable);
          if (currentClue && currentClue.key === clueKey) {
            currentClue.hintsAvailable = data.hintsAvailable;
          }
        }
        return data.stats;
      }
    } catch (err) {
      console.error('Failed to record attempt online:', err);
    }
    // If online request failed, queue for later
    await queuePendingAttempt(clueKey, timestamp, correct);
  } else {
    await queuePendingAttempt(clueKey, timestamp, correct);
  }

  // Return local stats
  return calculateLocalStats(clueKey);
}

async function updateClueHints(clueKey, hintsAvailable) {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction('clues', 'readwrite');
    const store = tx.objectStore('clues');
    const request = store.get(clueKey);

    request.onsuccess = () => {
      const record = request.result;
      if (record) {
        record.hintsAvailable = hintsAvailable;
        store.put(record);
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function calculateLocalStats(clueKey) {
  const attempts = await getAttempts(clueKey);
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

  const calcStats = (filtered) => {
    const total = filtered.length;
    const correct = filtered.filter(a => a.correct).length;
    const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
    return { total, correct, percent };
  };

  return {
    lifetime: calcStats(attempts),
    lastWeek: calcStats(attempts.filter(a => a.timestamp >= weekAgo)),
    lastDay: calcStats(attempts.filter(a => a.timestamp >= dayAgo)),
    lastHour: calcStats(attempts.filter(a => a.timestamp >= hourAgo))
  };
}

// === UI STATUS ===
function updateStatusIndicator(status) {
  const indicator = document.getElementById('statusIndicator');
  const text = document.getElementById('statusText');

  indicator.style.display = 'flex';
  indicator.className = 'status-indicator ' + status;

  if (status === 'offline') {
    text.textContent = 'Offline';
  } else if (status === 'syncing') {
    text.textContent = 'Syncing...';
  } else {
    text.textContent = 'Online';
  }
}

// === EVENT HANDLERS ===
window.addEventListener('online', () => {
  isOnline = true;
  updateStatusIndicator('online');
  syncPendingAttempts();
  syncFromServer();
});

window.addEventListener('offline', () => {
  isOnline = false;
  updateStatusIndicator('offline');
});

function toggleIncludeCompleted() {
  includeCompleted = !includeCompleted;
  document.getElementById('includeCompletedToggle').classList.toggle('active', includeCompleted);
  // Refresh from server if online (force since mode changed), then reinitialize session
  if (isOnline) {
    syncFromServer(true).then(() => initSession()).then(() => loadClue());
  } else {
    initSession().then(() => loadClue());
  }
}

// === QUIZ FUNCTIONS ===
async function loadClue() {
  // Clear any pending auto-advance
  if (autoAdvanceTimeout) {
    clearTimeout(autoAdvanceTimeout);
    autoAdvanceTimeout = null;
  }
  autoAdvancePaused = false;

  const container = document.getElementById('quiz');
  container.innerHTML = '<div class="loading">Loading clue...</div>';
  submitted = false;
  hintUsed = false;
  hintCheckedLetters = [];
  hintsUsedThisClue = 0;

  try {
    let clue;

    if (activeSession) {
      const sessionClue = selectNextSessionClue();
      if (!sessionClue) {
        showSessionComplete();
        return;
      }
      currentSessionClue = sessionClue;
      clue = sessionClue.clue;
    } else {
      clue = await selectNextClue();
    }

    if (!clue) {
      throw new Error('No clues available. Go online to sync clues.');
    }

    currentClue = clue;
    renderClue();
  } catch (err) {
    container.innerHTML = `<div class="error">${err.message}</div>`;
  }
}

function renderClue() {
  const container = document.getElementById('quiz');
  const pattern = currentClue.pattern || '';

  // Calculate hints available (default to 2x answer length if not set)
  const hintsAvailable = currentClue.hintsAvailable !== undefined
    ? currentClue.hintsAvailable
    : (currentClue.answer?.length || pattern.length) * 2;

  // Build letter inputs - show letters from pattern, leave blanks for underscores
  let letterInputs = '';
  for (let i = 0; i < pattern.length; i++) {
    const patternChar = pattern[i];
    const isFromPattern = patternChar !== '_';
    const displayChar = isFromPattern ? patternChar : '';

    let className = 'letter-input';
    if (isFromPattern) {
      className += ' from-pattern';
    } else {
      className += ' empty';
    }

    letterInputs += `<input
      type="text"
      class="${className}"
      value="${displayChar}"
      maxlength="1"
      data-index="${i}"
      data-from-pattern="${isFromPattern}"
    >`;
  }

  const streakClass = currentStreak > 0 ? '' : 'zero';
  const longestClass = longestStreak > 0 ? '' : 'zero';
  const hintsClass = hintsAvailable > 0 ? '' : 'zero';
  const hintBtnDisabled = hintsAvailable <= 0 ? 'disabled' : '';

  let sessionProgressHtml = '';
  if (activeSession && currentSessionClue) {
    const retiredCount = activeSession.sessionClues.filter(sc => sc.retired).length;
    const total = activeSession.sessionClues.length;
    const dotsHtml = activeSession.sessionClues.map(sc => {
      const filled = Math.min(sc.correctCount, SESSION_CORRECT_REQUIRED);
      const dotSpans = Array.from({ length: SESSION_CORRECT_REQUIRED }, (_, i) =>
        `<span class="dot ${i < filled ? 'dot-filled' : 'dot-empty'}"></span>`
      ).join('');
      return `<span class="session-clue-dots">${dotSpans}</span>`;
    }).join('');
    sessionProgressHtml = `
      <div class="session-progress">
        <span class="session-retired">${retiredCount}/${total} retired</span>
        <span class="session-dots-row">${dotsHtml}</span>
        <span class="session-attempts">${activeSession.totalAttempts} attempts</span>
      </div>`;
  }

  container.innerHTML = sessionProgressHtml + `
    <div class="streak-display">
      <div class="streak-item">
        <span class="streak-label">Streak:</span>
        <span class="streak-value ${streakClass}" id="currentStreak">${currentStreak}</span>
      </div>
      <div class="streak-item">
        <span class="streak-label">Best:</span>
        <span class="streak-value ${longestClass}" id="longestStreak">${longestStreak}</span>
      </div>
    </div>
    <div class="clue-text">${escapeHtml(currentClue.text)}</div>
    <div class="clue-meta">
      ${currentClue.direction.toUpperCase()} ${currentClue.number} - ${pattern.length} letters
      &nbsp;|&nbsp;
      <a href="/?date=${currentClue.puzzleDate}" class="puzzle-link">${currentClue.puzzleDate}</a>
    </div>
    <div class="letter-inputs" id="letterInputs">
      ${letterInputs}
    </div>
    <div id="result"></div>
    <div class="actions">
      <button class="submit-btn" id="submitBtn" onclick="checkAnswer()">Check Answer</button>
      <button class="hint-btn" id="hintBtn" onclick="useHint()" ${hintBtnDisabled}>Hint</button>
      <button class="skip-btn" onclick="skipClue()">Skip</button>
      <button class="ignore-btn" onclick="ignoreClue()">Ignore</button>
    </div>
    <div class="hints-display">
      Hints remaining: <span class="hints-count ${hintsClass}" id="hintsCount">${hintsAvailable}</span>
    </div>
  `;

  setupInputListeners();

  // Focus first empty input
  const inputs = container.querySelectorAll('.letter-input');
  for (const input of inputs) {
    if (!input.value) {
      input.focus();
      break;
    }
  }
}

function setupInputListeners() {
  const inputs = Array.from(document.querySelectorAll('.letter-input'));
  const pattern = currentClue.pattern;

  setupLetterInputNavigation(inputs, {
    onInput: (input, idx, val) => {
      const isFromPattern = input.dataset.fromPattern === 'true';
      const patternChar = pattern[idx];

      input.classList.remove('empty', 'user-entered', 'from-pattern');
      if (val) {
        if (isFromPattern && val === patternChar) {
          input.classList.add('from-pattern');
        } else {
          input.classList.add('user-entered');
        }
      } else {
        input.classList.add('empty');
      }

      // Move to next empty input
      if (val) {
        const nextEmpty = findNextEmptyInput(idx);
        if (nextEmpty) nextEmpty.focus();
      }

      // Auto-check if all filled and correct
      checkAutoComplete();
    },

    onEnter: (idx, e) => {
      if (submitted) {
        loadClue();
      } else {
        const allInputs = document.querySelectorAll('.letter-input');
        const allFilled = Array.from(allInputs).every(inp => inp.value);

        if (allFilled) {
          checkAnswer();
        } else if (e.target.value) {
          const nextEmpty = findNextEmptyInput(idx);
          if (nextEmpty) {
            nextEmpty.focus();
          } else {
            const firstEmpty = findNextEmptyInput(-1);
            if (firstEmpty) firstEmpty.focus();
          }
        } else {
          useHintForSquare(idx);
        }
      }
    }
  });

  // Mobile: scroll focused input into view when keyboard appears
  inputs.forEach(input => {
    input.addEventListener('focus', () => {
      setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    });
  });
}

function findNextEmptyInput(currentIdx) {
  const inputs = document.querySelectorAll('.letter-input');
  for (let i = currentIdx + 1; i < inputs.length; i++) {
    if (!inputs[i].value) return inputs[i];
  }
  return null;
}

function checkAutoComplete() {
  if (submitted || !currentClue) return;

  const inputs = document.querySelectorAll('.letter-input');
  const answer = currentClue.answer.toUpperCase();

  // Check if all filled and all correct
  for (let i = 0; i < inputs.length; i++) {
    const userChar = inputs[i].value.toUpperCase();
    if (!userChar || userChar !== answer[i]) {
      return; // Not complete or not correct
    }
  }

  // All filled and correct - auto-submit
  checkAnswer();
}

function useHintForSquare(targetIdx) {
  if (submitted) return;

  const hintsCountEl = document.getElementById('hintsCount');
  let hintsRemaining = parseInt(hintsCountEl?.textContent || '0');
  if (hintsRemaining <= 0) return;

  const inputs = document.querySelectorAll('.letter-input');
  const answer = currentClue.answer.toUpperCase();
  const input = inputs[targetIdx];
  const correctChar = answer[targetIdx];
  const userChar = input.value.toUpperCase();
  const isAlreadyIncorrect = input.classList.contains('hint-incorrect');
  const isAlreadyChecked = hintCheckedLetters[targetIdx];

  // Mark that hint was used
  hintUsed = true;

  let hintCost = 1;

  if (isAlreadyIncorrect) {
    // Case 3: Checked but incorrect - fill in correct letter (1 hint)
    hintCost = 1;
    input.value = correctChar;
    input.classList.remove('hint-incorrect', 'empty', 'user-entered', 'from-pattern');
    input.classList.add('hint-correct');
    input.readOnly = true;
    focusNextUncheckedInput(targetIdx);
  } else if (!userChar) {
    // Case 1: Blank - fill in correct letter (2 hints)
    hintCost = 2;
    hintCheckedLetters[targetIdx] = true;
    input.value = correctChar;
    input.classList.remove('empty', 'user-entered', 'from-pattern');
    input.classList.add('hint-correct');
    input.readOnly = true;
    focusNextUncheckedInput(targetIdx);
  } else if (!isAlreadyChecked) {
    // Case 2: Filled in but not checked - mark correct/incorrect (1 hint)
    hintCost = 1;
    hintCheckedLetters[targetIdx] = true;
    if (userChar === correctChar) {
      input.classList.remove('empty', 'user-entered', 'from-pattern');
      input.classList.add('hint-correct');
      input.readOnly = true;
      focusNextUncheckedInput(targetIdx);
    } else {
      input.classList.remove('empty', 'user-entered', 'from-pattern');
      input.classList.add('hint-incorrect');
      input.focus();
    }
  } else {
    // Already checked and correct - no action needed
    return;
  }

  // Deduct hints
  hintsUsedThisClue += hintCost;
  hintsRemaining -= hintCost;
  if (hintsCountEl) {
    hintsCountEl.textContent = Math.max(0, hintsRemaining);
    hintsCountEl.classList.toggle('zero', hintsRemaining <= 0);
  }

  // Disable hint button if no hints left
  const hintBtn = document.getElementById('hintBtn');
  if (hintBtn && hintsRemaining <= 0) {
    hintBtn.disabled = true;
  }
}

function focusNextUncheckedInput(currentIdx) {
  const inputs = document.querySelectorAll('.letter-input');
  // Find next letter that hasn't been checked via hint
  for (let i = currentIdx + 1; i < inputs.length; i++) {
    if (!hintCheckedLetters[i]) {
      inputs[i].focus();
      return;
    }
  }
  // If none found after, look from the beginning
  for (let i = 0; i < currentIdx; i++) {
    if (!hintCheckedLetters[i]) {
      inputs[i].focus();
      return;
    }
  }
}

function useHint() {
  if (submitted) return;

  const inputs = document.querySelectorAll('.letter-input');

  // Single pass left-to-right: find first character that is:
  // - blank, OR
  // - filled but not checked, OR
  // - checked but incorrect
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const isBlank = !input.value;
    const isFilledUnchecked = input.value && !hintCheckedLetters[i];
    const isIncorrect = input.classList.contains('hint-incorrect');

    if (isBlank || isFilledUnchecked || isIncorrect) {
      useHintForSquare(i);
      return;
    }
  }
}

async function checkAnswer() {
  if (submitted) return;

  const inputs = document.querySelectorAll('.letter-input');
  const answer = currentClue.answer.toUpperCase();

  // Don't allow checking if any squares are empty
  const hasEmpty = Array.from(inputs).some(input => !input.value);
  if (hasEmpty) return;

  let userAnswer = '';
  let allCorrect = true;

  inputs.forEach((input, idx) => {
    const userChar = input.value.toUpperCase();
    const correctChar = answer[idx];
    userAnswer += userChar;

    input.classList.remove('correct', 'incorrect', 'empty', 'user-entered', 'from-pattern', 'hint-correct', 'hint-incorrect');

    if (userChar === correctChar) {
      input.classList.add('correct');
    } else {
      input.classList.add('incorrect');
      allCorrect = false;
      // Show correct answer for incorrect letters
      input.value = correctChar;
    }
    input.readOnly = true;
  });

  submitted = true;
  sessionStats.total++;

  // Using a hint counts as incorrect
  const countAsCorrect = allCorrect && !hintUsed;
  if (countAsCorrect) {
    sessionStats.correct++;
    currentStreak++;
    if (currentStreak > longestStreak) {
      longestStreak = currentStreak;
      localStorage.setItem('longestStreak', longestStreak.toString());
    }
  } else {
    currentStreak = 0;
  }

  // Update streak display
  const currentStreakEl = document.getElementById('currentStreak');
  const longestStreakEl = document.getElementById('longestStreak');
  if (currentStreakEl) {
    currentStreakEl.textContent = currentStreak;
    currentStreakEl.classList.toggle('zero', currentStreak === 0);
  }
  if (longestStreakEl) {
    longestStreakEl.textContent = longestStreak;
    longestStreakEl.classList.toggle('zero', longestStreak === 0);
  }

  const resultDiv = document.getElementById('result');
  if (allCorrect && hintUsed) {
    resultDiv.innerHTML = '<div class="result incorrect">Correct, but hint was used</div>';
  } else if (allCorrect) {
    resultDiv.innerHTML = '<div class="result correct">Correct!</div>';
  } else {
    resultDiv.innerHTML = `<div class="result incorrect">Incorrect - the answer was ${answer}</div>`;
  }

  document.getElementById('submitBtn').outerHTML =
    '<button class="next-btn" onclick="loadClue()">Next Clue</button>';
  if (allCorrect) {
    document.getElementById('hintBtn').outerHTML =
      '<button class="pause-btn" id="pauseBtn" onclick="togglePause()">Pause</button>';
  } else {
    document.getElementById('hintBtn').style.display = 'none';
  }

  updateStats();

  // Record attempt and show clue stats (hint usage counts as incorrect)
  const clueKey = currentClue.key;
  const answerLength = currentClue.answer?.length || 0;
  // Pass both: countAsCorrect (for stats) and allCorrect (for hint updates)
  const stats = await recordAttempt(clueKey, countAsCorrect, answerLength, hintsUsedThisClue, allCorrect);
  displayClueStats(stats);

  if (activeSession && currentSessionClue) {
    recordSessionAttempt(currentSessionClue, allCorrect);
  }

  // Auto-advance after 1 second (only if correct)
  if (allCorrect) {
    autoAdvancePaused = false;
    autoAdvanceTimeout = setTimeout(() => {
      if (!autoAdvancePaused) {
        loadClue();
      }
    }, 1000);
  }
}

function togglePause() {
  autoAdvancePaused = !autoAdvancePaused;
  const pauseBtn = document.getElementById('pauseBtn');
  if (pauseBtn) {
    if (autoAdvancePaused) {
      pauseBtn.textContent = 'Resume';
      pauseBtn.classList.remove('pause-btn');
      pauseBtn.classList.add('next-btn');
      if (autoAdvanceTimeout) {
        clearTimeout(autoAdvanceTimeout);
        autoAdvanceTimeout = null;
      }
    } else {
      loadClue();
    }
  }
}

async function skipClue() {
  if (submitted) {
    loadClue();
    return;
  }

  // Record as incorrect
  const clueKey = currentClue.key;
  const answerLength = currentClue.answer?.length || 0;
  await recordAttempt(clueKey, false, answerLength, hintsUsedThisClue);

  // Update session stats
  sessionStats.total++;
  currentStreak = 0;

  if (activeSession && currentSessionClue) {
    recordSessionAttempt(currentSessionClue, false);
  }

  updateStats();
  loadClue();
}

async function ignoreClue() {
  if (!currentClue) return;

  const clueId = `${currentClue.direction}-${currentClue.number}`;
  const puzzleDate = currentClue.puzzleDate;

  if (activeSession && currentSessionClue) {
    currentSessionClue.retired = true;
    saveSession();
  }

  try {
    // Mark as ignored on server
    if (isOnline) {
      const res = await fetch(`${API_BASE}/api/clue/${clueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puzzleDate,
          updates: { ignored: true }
        })
      });

      if (!res.ok) {
        console.error('Failed to ignore clue on server');
      }
    }

    // Remove from local IndexedDB
    await removeLocalClue(currentClue.key);

    // Load next clue
    loadClue();
  } catch (err) {
    console.error('Error ignoring clue:', err);
    loadClue();
  }
}

async function removeLocalClue(clueKey) {
  return new Promise((resolve, reject) => {
    const tx = dbTransaction('clues', 'readwrite');
    const store = tx.objectStore('clues');
    store.delete(clueKey);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function displayClueStats(stats) {
  const resultDiv = document.getElementById('result');

  const formatStat = (stat) => {
    if (stat.total === 0) return { value: '-', detail: 'No attempts' };
    return {
      value: `${stat.percent}%`,
      detail: `${stat.correct}/${stat.total}`
    };
  };

  const lifetime = formatStat(stats.lifetime);
  const week = formatStat(stats.lastWeek);
  const day = formatStat(stats.lastDay);
  const hour = formatStat(stats.lastHour);

  resultDiv.innerHTML += `
    <div class="clue-stats">
      <div class="clue-stats-title">Performance on this clue</div>
      <div class="clue-stats-grid">
        <div class="stat-item">
          <div class="stat-label">Lifetime</div>
          <div class="stat-value">${lifetime.value}</div>
          <div class="stat-detail">${lifetime.detail}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Last Week</div>
          <div class="stat-value">${week.value}</div>
          <div class="stat-detail">${week.detail}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Last Day</div>
          <div class="stat-value">${day.value}</div>
          <div class="stat-detail">${day.detail}</div>
        </div>
        <div class="stat-item">
          <div class="stat-label">Last Hour</div>
          <div class="stat-value">${hour.value}</div>
          <div class="stat-detail">${hour.detail}</div>
        </div>
      </div>
    </div>
  `;
}

function updateStats() {
  const statsDiv = document.getElementById('stats');
  if (sessionStats.total > 0) {
    const pct = Math.round((sessionStats.correct / sessionStats.total) * 100);
    statsDiv.textContent = `Score: ${sessionStats.correct}/${sessionStats.total} (${pct}%)`;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// === CACHE MANAGEMENT ===
async function clearCache() {
  if (!confirm('Clear all cached quiz data? This will remove locally stored clues and attempt history.')) {
    return;
  }

  try {
    // Close existing connection
    if (db) {
      db.close();
      db = null;
    }

    // Delete the database
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    // Clear sync metadata from localStorage and session state
    localStorage.removeItem('longestStreak');
    sessionStorage.removeItem('quiz-session');

    alert('Cache cleared. Page will reload.');
    window.location.reload();
  } catch (err) {
    console.error('Failed to clear cache:', err);
    alert('Failed to clear cache: ' + err.message);
  }
}

// === INITIALIZATION ===
async function init() {
  try {
    await openDatabase();

    // Update status
    updateStatusIndicator(isOnline ? 'online' : 'offline');

    // Check if we have local data
    const localClues = await getAllClues();
    const hasLocalData = localClues.length > 0;

    if (hasLocalData) {
      if (restoreSession()) {
        // Continue an in-progress session immediately from cache for a snappy
        // start; a background full sync (if due) prunes any now-ignored clues.
        await loadClue();
        if (isOnline) {
          syncFromServer(false).then(() => syncPendingAttempts());
        }
      } else {
        // Building a new session — pull fresh eligibility first when online so
        // ignored/removed clues are excluded from the selection.
        if (isOnline) await syncFromServer(true);
        await initSession();
        await loadClue();
        if (isOnline) syncPendingAttempts();
      }
      return;
    }

    // No local data - must sync first
    if (isOnline) {
      await syncFromServer(true);
      await syncPendingAttempts();
    }

    await initSession();
    await loadClue();
  } catch (err) {
    console.error('Initialization error:', err);
    document.getElementById('quiz').innerHTML =
      `<div class="error">Failed to initialize: ${err.message}</div>`;
  }
}

// Global keyboard shortcuts (only when not in input)
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key.toLowerCase() === 'q') window.location.href = '/quiz.html';
  if (e.key.toLowerCase() === 'p') window.location.href = '/puzzles.html';
  if (e.key.toLowerCase() === 'r') window.location.href = '/recommendations.html';
});

init();
