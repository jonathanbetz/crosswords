// NYT Archive Crawler
// This script runs in the context of the NYT website and imports unsolved puzzles

(async function() {
  'use strict';

  const API_BASE = 'https://crosswords-ten.vercel.app';
  const STORAGE_KEY = 'nyt-crawler-state';
  const DELAY_BETWEEN_PUZZLES = 1000; // 1 second between puzzle fetches
  const DELAY_BETWEEN_MONTHS = 500; // 0.5 second between month scans

  // ==================== UI ====================

  function createUI() {
    // Remove existing UI if present
    const existing = document.getElementById('crawler-ui');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'crawler-ui';
    container.innerHTML = `
      <style>
        #crawler-ui {
          position: fixed;
          bottom: 20px;
          right: 20px;
          width: 380px;
          max-height: 500px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.2);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          z-index: 999999;
          overflow: hidden;
        }
        #crawler-header {
          background: linear-gradient(135deg, #007bff, #0056b3);
          color: white;
          padding: 16px;
          font-weight: 600;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #crawler-close {
          background: rgba(255,255,255,0.2);
          border: none;
          color: white;
          width: 28px;
          height: 28px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }
        #crawler-close:hover {
          background: rgba(255,255,255,0.3);
        }
        #crawler-content {
          padding: 16px;
        }
        #crawler-progress {
          margin-bottom: 12px;
        }
        #crawler-progress-bar {
          height: 8px;
          background: #e9ecef;
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 8px;
        }
        #crawler-progress-fill {
          height: 100%;
          background: #28a745;
          transition: width 0.3s;
          width: 0%;
        }
        #crawler-status {
          font-size: 14px;
          color: #333;
          margin-bottom: 4px;
        }
        #crawler-substatus {
          font-size: 12px;
          color: #666;
        }
        #crawler-log {
          height: 200px;
          overflow-y: auto;
          background: #f8f9fa;
          border-radius: 8px;
          padding: 12px;
          font-size: 12px;
          font-family: monospace;
          margin-bottom: 12px;
        }
        .crawler-log-entry {
          margin-bottom: 4px;
          line-height: 1.4;
        }
        .crawler-log-entry.success { color: #28a745; }
        .crawler-log-entry.error { color: #dc3545; }
        .crawler-log-entry.info { color: #666; }
        #crawler-actions {
          display: flex;
          gap: 8px;
        }
        .crawler-btn {
          flex: 1;
          padding: 10px;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 500;
          font-size: 14px;
        }
        .crawler-btn-primary {
          background: #007bff;
          color: white;
        }
        .crawler-btn-primary:hover { background: #0056b3; }
        .crawler-btn-primary:disabled { background: #ccc; cursor: not-allowed; }
        .crawler-btn-secondary {
          background: #6c757d;
          color: white;
        }
        .crawler-btn-secondary:hover { background: #545b62; }
        .crawler-btn-danger {
          background: #dc3545;
          color: white;
        }
        .crawler-btn-danger:hover { background: #c82333; }
      </style>
      <div id="crawler-header">
        <span>NYT Puzzle Importer</span>
        <button id="crawler-close">&times;</button>
      </div>
      <div id="crawler-content">
        <div id="crawler-progress">
          <div id="crawler-progress-bar">
            <div id="crawler-progress-fill"></div>
          </div>
          <div id="crawler-status">Ready to start</div>
          <div id="crawler-substatus"></div>
        </div>
        <div id="crawler-log"></div>
        <div id="crawler-actions">
          <button class="crawler-btn crawler-btn-primary" id="crawler-start">Start Import</button>
          <button class="crawler-btn crawler-btn-secondary" id="crawler-pause" style="display:none">Pause</button>
          <button class="crawler-btn crawler-btn-secondary" id="crawler-copy">Copy Log</button>
          <button class="crawler-btn crawler-btn-danger" id="crawler-reset">Reset</button>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    // Event handlers
    document.getElementById('crawler-close').onclick = () => container.remove();
    document.getElementById('crawler-start').onclick = startCrawler;
    document.getElementById('crawler-pause').onclick = pauseCrawler;
    document.getElementById('crawler-reset').onclick = resetCrawler;
    document.getElementById('crawler-copy').onclick = () => {
      const log = document.getElementById('crawler-log');
      const text = Array.from(log.querySelectorAll('.crawler-log-entry'))
        .map(e => e.textContent)
        .join('\n');
      navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById('crawler-copy');
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = 'Copy Log', 2000);
      });
    };

    return {
      setStatus: (text) => {
        document.getElementById('crawler-status').textContent = text;
      },
      setSubstatus: (text) => {
        document.getElementById('crawler-substatus').textContent = text;
      },
      setProgress: (current, total) => {
        const pct = total > 0 ? (current / total) * 100 : 0;
        document.getElementById('crawler-progress-fill').style.width = pct + '%';
      },
      log: (message, type = 'info') => {
        const log = document.getElementById('crawler-log');
        const entry = document.createElement('div');
        entry.className = `crawler-log-entry ${type}`;
        entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
      },
      showPause: () => {
        document.getElementById('crawler-start').style.display = 'none';
        document.getElementById('crawler-pause').style.display = 'block';
      },
      showStart: () => {
        document.getElementById('crawler-start').style.display = 'block';
        document.getElementById('crawler-pause').style.display = 'none';
      },
      enableStart: () => {
        document.getElementById('crawler-start').disabled = false;
      },
      disableStart: () => {
        document.getElementById('crawler-start').disabled = true;
      }
    };
  }

  // ==================== State Management ====================
  // Note: We don't persist state to localStorage because storing 10,000+
  // puzzle dates would exceed the quota. The crawler runs in one session.

  function loadState() {
    return null; // Always start fresh
  }

  function saveState(state) {
    // No-op - don't persist to avoid quota issues
  }

  function clearState() {
    // No-op
  }

  // ==================== NYT Data Extraction ====================

  async function fetchExistingPuzzles() {
    const res = await fetch(`${API_BASE}/api/clues`);
    if (!res.ok) throw new Error('Failed to fetch existing puzzles');
    const data = await res.json();
    return new Set(data.dates || []);
  }

  function scanCurrentPage(ui) {
    // Scan the current page's DOM for puzzle links
    const puzzles = [];

    // Look for puzzle links
    let links = document.querySelectorAll('a[href*="/crosswords/game/daily/"]');

    if (links.length === 0) {
      links = document.querySelectorAll('a[href*="/game/daily/"]');
    }

    if (links.length === 0) {
      ui.log('No puzzle links found on page', 'error');
      return puzzles;
    }

    for (const link of links) {
      const href = link.getAttribute('href');
      const match = href.match(/\/(?:crosswords\/)?game\/daily\/(\d{4})\/(\d{2})\/(\d{2})/);
      if (!match) continue;

      const date = `${match[1]}-${match[2]}-${match[3]}`;

      // Check if puzzle is solved by looking for data-star attribute (any value)
      // data-star="true" = gold star (streak), data-star="false" = blue star (solved)
      // No data-star attribute = unsolved
      let isSolved = false;

      // Check inside the link itself for any element with data-star attribute
      if (link.querySelector('[data-star]')) {
        isSolved = true;
      }

      // Also check the parent calendar item container
      if (!isSolved) {
        const container = link.closest('.archive_calendar-item');
        if (container && container.querySelector('[data-star]')) {
          isSolved = true;
        }
      }

      puzzles.push({ date, solved: isSolved });
    }

    return puzzles;
  }

  function getAvailableMonths() {
    // Get all available year/month combinations from the dropdowns
    const yearSelect = document.querySelector('select[data-testid="year-selector"]');
    const monthSelect = document.querySelector('select[data-testid="month-selector"]');

    if (!yearSelect || !monthSelect) {
      return [];
    }

    const months = [];
    const years = Array.from(yearSelect.options).map(o => parseInt(o.value));

    // For now, just return current year/month - we'll navigate and check each
    for (const year of years) {
      for (let month = 0; month < 12; month++) {
        months.push({ year, month });
      }
    }

    return months;
  }

  async function navigateToMonth(year, month, ui) {
    const yearSelect = document.querySelector('select[data-testid="year-selector"]');
    const monthSelect = document.querySelector('select[data-testid="month-selector"]');

    if (!yearSelect || !monthSelect) {
      throw new Error('Could not find archive dropdowns');
    }

    // Change year first
    yearSelect.value = year.toString();
    yearSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for React to update the month options
    await delay(500);

    // Now change month (check if it's enabled)
    const monthOption = monthSelect.querySelector(`option[value="${month}"]`);
    if (!monthOption || monthOption.disabled) {
      return false; // Month not available for this year
    }

    monthSelect.value = month.toString();
    monthSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for calendar to fully render - retry until we see puzzle links
    for (let attempt = 0; attempt < 5; attempt++) {
      await delay(400);
      const links = document.querySelectorAll('a[href*="/crosswords/game/daily/"]');
      if (links.length > 0) {
        // Verify we're seeing the right month by checking the first link
        const href = links[0].getAttribute('href');
        const expectedPrefix = `/crosswords/game/daily/${year}/${String(month + 1).padStart(2, '0')}`;
        if (href.includes(expectedPrefix)) {
          return true;
        }
      }
    }

    // If we get here, calendar didn't load properly
    return true; // Still return true to try scanning anyway
  }

  async function fetchPuzzleData(date) {
    // Parse date
    const [year, month, day] = date.split('-');
    const url = `https://www.nytimes.com/crosswords/game/daily/${year}/${month}/${day}`;

    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`Failed to fetch puzzle ${date}`);

    const html = await res.text();

    // Try to extract puzzle data from the page
    // NYT embeds puzzle data in a script tag or window variable

    // Method 1: Look for window.gameData
    let gameDataMatch = html.match(/window\.gameData\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
    if (gameDataMatch) {
      try {
        const gameData = JSON.parse(gameDataMatch[1]);
        return extractCluesFromGameData(gameData);
      } catch (e) {
        // Continue to next method
      }
    }

    // Method 2: Look for embedded JSON in script tags
    const scriptMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(\{[\s\S]*?\})<\/script>/);
    if (scriptMatch) {
      try {
        const nextData = JSON.parse(scriptMatch[1]);
        return extractCluesFromNextData(nextData);
      } catch (e) {
        // Continue to next method
      }
    }

    // Method 3: Try to find puzzle data in any script tag
    const allScripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [];
    for (const script of allScripts) {
      if (script.includes('"clues"') && script.includes('"answers"')) {
        const jsonMatch = script.match(/\{[\s\S]*"clues"[\s\S]*"answers"[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const data = JSON.parse(jsonMatch[0]);
            return extractCluesFromGameData(data);
          } catch (e) {
            continue;
          }
        }
      }
    }

    throw new Error('Could not extract puzzle data from page');
  }

  function extractCluesFromGameData(gameData) {
    // Handle NYT's puzzle data format
    const clues = [];
    const puzzle = gameData.puzzle || gameData;

    const clueData = puzzle.clues || {};
    const answers = puzzle.answers || {};

    // Process across clues
    if (Array.isArray(clueData.across)) {
      for (const clue of clueData.across) {
        clues.push({
          number: clue.number || clue[0],
          direction: 'across',
          text: clue.text || clue.clue || clue[1],
          answer: clue.answer || ''
        });
      }
    }

    // Process down clues
    if (Array.isArray(clueData.down)) {
      for (const clue of clueData.down) {
        clues.push({
          number: clue.number || clue[0],
          direction: 'down',
          text: clue.text || clue.clue || clue[1],
          answer: clue.answer || ''
        });
      }
    }

    // Try to get answers from grid if not in clues
    if (puzzle.grid && clues.some(c => !c.answer)) {
      // Reconstruct answers from grid (complex, skip for now)
    }

    // Try answers object
    if (answers.across) {
      for (let i = 0; i < clues.length; i++) {
        if (clues[i].direction === 'across' && !clues[i].answer) {
          const ans = answers.across.find(a => a.number === clues[i].number || a[0] === clues[i].number);
          if (ans) clues[i].answer = ans.answer || ans[1] || '';
        }
      }
    }
    if (answers.down) {
      for (let i = 0; i < clues.length; i++) {
        if (clues[i].direction === 'down' && !clues[i].answer) {
          const ans = answers.down.find(a => a.number === clues[i].number || a[0] === clues[i].number);
          if (ans) clues[i].answer = ans.answer || ans[1] || '';
        }
      }
    }

    return { clues };
  }

  function extractCluesFromNextData(nextData) {
    // Navigate through Next.js data structure
    const props = nextData.props || {};
    const pageProps = props.pageProps || {};
    const gameData = pageProps.gameData || pageProps.puzzle || {};

    return extractCluesFromGameData(gameData);
  }

  async function importPuzzle(date, clues) {
    const res = await fetch(`${API_BASE}/api/import-puzzle?action=bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ puzzleDate: date, clues })
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error.error || 'Import failed');
    }

    return res.json();
  }

  // ==================== Crawler Logic ====================

  let isPaused = false;
  let ui = null;

  async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function startCrawler() {
    ui = createUI();
    ui.showPause();
    isPaused = false;

    try {
      // Load previous state or start fresh
      let state = loadState() || {
        phase: 'scanning',
        scannedMonths: [],
        unsolvedDates: [],
        importedDates: [],
        failedDates: []
      };

      // Always fetch existing puzzles fresh (don't store in localStorage to avoid quota issues)
      ui.setStatus('Fetching existing puzzles...');
      ui.log('Connecting to Crossword Trainer API...');
      const existingSet = await fetchExistingPuzzles();
      ui.log(`Found ${existingSet.size} puzzles already in system`, 'success');

      // Phase 2: Scan all archive pages
      if (state.phase === 'scanning') {
        ui.setStatus('Scanning archive...');

        // Get all year/month combinations to scan
        const allMonths = getAvailableMonths();
        const totalMonths = allMonths.length;

        // Track which months we've scanned in this session
        const scannedKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
        const scannedMonths = new Set(state.scannedMonths || []);

        let totalUnsolved = 0;
        let totalSolvedOnNYT = 0;
        let totalImported = 0;
        let totalFailed = 0;

        for (let i = 0; i < allMonths.length; i++) {
          if (isPaused) {
            ui.setStatus('Paused');
            ui.showStart();
            return;
          }

          const { year, month } = allMonths[i];
          const monthKey = scannedKey(year, month);

          // Skip already scanned months
          if (scannedMonths.has(monthKey)) {
            continue;
          }

          ui.setProgress(i, totalMonths);
          const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month];
          ui.setSubstatus(`Scanning ${monthName} ${year}...`);

          // Navigate to this month
          const available = await navigateToMonth(year, month, ui);
          if (!available) {
            // Month not available (e.g., future month)
            scannedMonths.add(monthKey);
            continue;
          }

          // Scan the page
          const puzzles = scanCurrentPage(ui);
          const unsolved = puzzles.filter(p => !p.solved && !existingSet.has(p.date));
          const solvedOnNYT = puzzles.filter(p => p.solved).length;

          totalUnsolved += unsolved.length;
          totalSolvedOnNYT += solvedOnNYT;

          scannedMonths.add(monthKey);

          // Import puzzles immediately as we find them
          if (unsolved.length > 0) {
            ui.log(`${monthName} ${year}: importing ${unsolved.length} puzzles...`, 'success');

            for (const puzzle of unsolved) {
              if (isPaused) {
                ui.setStatus('Paused');
                ui.showStart();
                return;
              }

              try {
                const puzzleData = await fetchPuzzleData(puzzle.date);
                if (!puzzleData.clues || puzzleData.clues.length === 0) {
                  throw new Error('No clues found');
                }
                await importPuzzle(puzzle.date, puzzleData.clues);
                totalImported++;
                existingSet.add(puzzle.date); // Add to set so we don't re-import
                ui.log(`  ${puzzle.date}: ${puzzleData.clues.length} clues`, 'info');
              } catch (err) {
                totalFailed++;
                ui.log(`  ${puzzle.date}: ${err.message}`, 'error');
              }

              await delay(DELAY_BETWEEN_PUZZLES);
            }
          }

          await delay(DELAY_BETWEEN_MONTHS);
        }

        ui.log(`Done! Imported ${totalImported}, failed ${totalFailed}, skipped ${totalSolvedOnNYT} solved`, 'success');
      }

      // Done
      ui.setStatus('Complete!');
      ui.setProgress(100, 100);
      ui.showStart();
      ui.disableStart();

    } catch (err) {
      ui.log(`Error: ${err.message}`, 'error');
      ui.setStatus('Error occurred');
      ui.showStart();
    }
  }

  function pauseCrawler() {
    isPaused = true;
    if (ui) {
      ui.log('Pausing...', 'info');
    }
  }

  function resetCrawler() {
    if (confirm('This will clear all progress. Are you sure?')) {
      clearState();
      if (ui) {
        ui.setStatus('Ready to start');
        ui.setSubstatus('');
        ui.setProgress(0, 100);
        ui.log('Progress reset.', 'info');
        ui.showStart();
        ui.enableStart();
      }
    }
  }

  // ==================== Initialize ====================

  // Check if we're on NYT
  if (!window.location.hostname.includes('nytimes.com')) {
    alert('Please run this on the NYT Crossword Archive page:\nhttps://www.nytimes.com/crosswords/archive/daily');
    return;
  }

  // Show UI
  ui = createUI();

  // Check for existing progress
  const savedState = loadState();
  if (savedState && savedState.phase !== 'complete') {
    ui.log(`Found saved progress: ${savedState.importedDates?.length || 0} imported, ${savedState.unsolvedDates?.length || 0} total`, 'info');
    ui.setStatus('Click Start to resume');
  }

})();
