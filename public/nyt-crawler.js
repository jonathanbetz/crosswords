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
          <button class="crawler-btn crawler-btn-primary" id="crawler-start">Full Import</button>
          <button class="crawler-btn crawler-btn-secondary" id="crawler-test">This Page</button>
          <button class="crawler-btn crawler-btn-secondary" id="crawler-pause" style="display:none">Pause</button>
          <button class="crawler-btn crawler-btn-secondary" id="crawler-copy">Copy Log</button>
        </div>
      </div>
    `;

    document.body.appendChild(container);

    // Event handlers
    document.getElementById('crawler-close').onclick = () => container.remove();
    document.getElementById('crawler-start').onclick = () => startCrawler(false);
    document.getElementById('crawler-test').onclick = () => startCrawler(true);
    document.getElementById('crawler-pause').onclick = pauseCrawler;
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

      // Check if puzzle is solved by looking for star classes
      // puzzleProgressGoldStar = solved with streak
      // puzzleProgressBlueStar = solved without streak
      // puzzleProgress4, puzzleProgress50, etc. = in progress (percentage)
      let isSolved = false;

      // Check for star classes inside the link
      const starEl = link.querySelector('.puzzleProgressGoldStar, .puzzleProgressBlueStar');
      if (starEl) {
        isSolved = true;
      }

      // Also check the parent calendar item container
      if (!isSolved) {
        const container = link.closest('.archive_calendar-item');
        if (container && container.querySelector('.puzzleProgressGoldStar, .puzzleProgressBlueStar')) {
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

    // Load puzzle page in hidden iframe to get rendered DOM
    return new Promise((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1024px;height:768px;';
      iframe.src = url;

      const timeout = setTimeout(() => {
        iframe.remove();
        reject(new Error('Timeout loading puzzle'));
      }, 30000);

      iframe.onload = async () => {
        try {
          // Wait for puzzle to render
          await delay(2000);

          const doc = iframe.contentDocument;
          if (!doc) throw new Error('Cannot access iframe');

          // Extract clues and grid from rendered page
          const result = extractFromDocument(doc);
          clearTimeout(timeout);
          iframe.remove();

          if (!result.clues || result.clues.length === 0) {
            throw new Error('No clues found');
          }

          resolve(result);
        } catch (e) {
          clearTimeout(timeout);
          iframe.remove();
          reject(e);
        }
      };

      iframe.onerror = () => {
        clearTimeout(timeout);
        iframe.remove();
        reject(new Error('Failed to load puzzle page'));
      };

      document.body.appendChild(iframe);
    });
  }

  function extractFromDocument(doc) {
    const clues = [];

    // Extract grid state (letters user has filled in)
    const grid = extractGridFromDoc(doc);

    // Extract clues from the clue list
    const clueElements = doc.querySelectorAll('.xwd__clue--li, [class*="Clue-li"], li[class*="clue"]');

    clueElements.forEach(el => {
      const labelEl = el.querySelector('.xwd__clue--label, [class*="label"]');
      const textEl = el.querySelector('.xwd__clue--text, [class*="text"]');

      if (!labelEl || !textEl) return;

      const number = parseInt(labelEl.textContent.trim(), 10);
      const text = textEl.textContent.trim();
      if (isNaN(number) || !text) return;

      // Determine direction from parent
      let direction = 'across';
      let parent = el.parentElement;
      while (parent) {
        const cls = parent.className || '';
        if (/down/i.test(cls)) { direction = 'down'; break; }
        if (/across/i.test(cls)) { direction = 'across'; break; }
        parent = parent.parentElement;
      }

      // Get the current pattern from grid
      const pattern = getPatternFromGrid(grid, number, direction);

      clues.push({ number, direction, text, pattern, answer: pattern });
    });

    return { clues };
  }

  function extractGridFromDoc(doc) {
    const grid = { cells: [], size: 0, cellsByNumber: new Map() };

    // Try SVG grid (newer NYT layout)
    const svgCells = doc.querySelectorAll('g[data-group="cells"] g.xwd__cell');
    if (svgCells.length === 0) return grid;

    const cellData = [];
    const cellSize = 33;

    svgCells.forEach(cell => {
      const rect = cell.querySelector('rect');
      if (!rect) return;

      const x = parseFloat(rect.getAttribute('x') || '0');
      const y = parseFloat(rect.getAttribute('y') || '0');
      const col = Math.round((x - 3) / cellSize);
      const row = Math.round((y - 3) / cellSize);
      const isBlack = rect.classList.contains('xwd__cell--block');

      let cellNumber = null;
      let letter = null;

      cell.querySelectorAll('text').forEach(text => {
        const fontSize = parseFloat(text.getAttribute('font-size') || '0');
        let content = '';
        text.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) content += node.textContent;
        });
        content = content.trim();

        if (fontSize > 12 && /^[A-Z]+$/i.test(content)) {
          letter = content.toUpperCase();
        } else if (fontSize <= 12 && /^\d+$/.test(content)) {
          cellNumber = parseInt(content, 10);
        }
      });

      cellData.push({ row, col, isBlack, cellNumber, letter });
    });

    if (cellData.length === 0) return grid;

    const maxRow = Math.max(...cellData.map(c => c.row));
    const maxCol = Math.max(...cellData.map(c => c.col));
    grid.size = Math.max(maxRow, maxCol) + 1;

    grid.cells = new Array(grid.size * grid.size).fill(null).map(() => ({
      isBlack: false, letter: null, cellNumber: null
    }));

    cellData.forEach(({ row, col, isBlack, cellNumber, letter }) => {
      const idx = row * grid.size + col;
      if (idx >= 0 && idx < grid.cells.length) {
        grid.cells[idx] = { isBlack, letter, cellNumber };
        if (cellNumber) grid.cellsByNumber.set(cellNumber, { row, col });
      }
    });

    return grid;
  }

  function getPatternFromGrid(grid, clueNumber, direction) {
    const startPos = grid.cellsByNumber.get(clueNumber);
    if (!startPos) return '';

    let { row, col } = startPos;
    const pattern = [];

    while (row < grid.size && col < grid.size) {
      const idx = row * grid.size + col;
      const cell = grid.cells[idx];
      if (!cell || cell.isBlack) break;

      pattern.push(cell.letter || '_');

      if (direction === 'across') col++;
      else row++;
    }

    return pattern.join('');
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

  async function scanAndImportPage(ui, existingSet) {
    const puzzles = scanCurrentPage(ui);
    const solved = puzzles.filter(p => p.solved).length;
    const inSystem = puzzles.filter(p => existingSet.has(p.date)).length;
    const unsolved = puzzles.filter(p => !p.solved && !existingSet.has(p.date));

    let imported = 0;
    let failed = 0;

    for (const puzzle of unsolved) {
      if (isPaused) {
        break;
      }

      try {
        const puzzleData = await fetchPuzzleData(puzzle.date);
        if (!puzzleData.clues || puzzleData.clues.length === 0) {
          throw new Error('No clues found');
        }
        await importPuzzle(puzzle.date, puzzleData.clues);
        imported++;
        existingSet.add(puzzle.date);
        ui.log(`  ${puzzle.date}: ${puzzleData.clues.length} clues`, 'success');
      } catch (err) {
        failed++;
        ui.log(`  ${puzzle.date}: ${err.message}`, 'error');
      }

      await delay(DELAY_BETWEEN_PUZZLES);
    }

    return { total: puzzles.length, solved, inSystem, imported, failed };
  }

  async function startCrawler(singlePageOnly = false) {
    ui = createUI();
    ui.showPause();
    isPaused = false;

    try {
      // Always fetch existing puzzles fresh
      ui.setStatus('Fetching existing puzzles...');
      ui.log('Connecting to Crossword Trainer API...');
      const existingSet = await fetchExistingPuzzles();
      ui.log(`Found ${existingSet.size} puzzles already in system`, 'success');

      let totalImported = 0;
      let totalFailed = 0;
      let totalSolvedOnNYT = 0;

      if (singlePageOnly) {
        // Test mode: just scan and import current page
        ui.setStatus('Scanning current page...');
        const result = await scanAndImportPage(ui, existingSet);
        totalImported = result.imported;
        totalFailed = result.failed;
        totalSolvedOnNYT = result.solved;
      } else {
        // Full mode: scan all archive pages
        ui.setStatus('Scanning archive...');

        const allMonths = getAvailableMonths();
        const totalMonths = allMonths.length;

        for (let i = 0; i < allMonths.length; i++) {
          if (isPaused) {
            ui.setStatus('Paused');
            ui.showStart();
            return;
          }

          const { year, month } = allMonths[i];
          const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month];

          ui.setProgress(i, totalMonths);
          ui.setSubstatus(`${monthName} ${year}`);

          // Navigate to this month
          const available = await navigateToMonth(year, month, ui);
          if (!available) {
            ui.log(`${monthName} ${year}: skipped (not available)`, 'info');
            continue;
          }

          // Scan and import
          const result = await scanAndImportPage(ui, existingSet);
          totalImported += result.imported;
          totalFailed += result.failed;
          totalSolvedOnNYT += result.solved;

          // Log month summary
          ui.log(`${monthName} ${year}: ${result.total} puzzles, ${result.solved} solved, ${result.inSystem} in system, ${result.imported} imported`,
            result.imported > 0 ? 'success' : 'info');

          await delay(DELAY_BETWEEN_MONTHS);
        }
      }

      // Done
      ui.log(`Done! Imported ${totalImported}, failed ${totalFailed}, skipped ${totalSolvedOnNYT} solved`, 'success');
      ui.setStatus('Complete!');
      ui.setProgress(100, 100);
      ui.showStart();

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
