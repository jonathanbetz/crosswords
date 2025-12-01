// Content script for NYT Crossword Trainer
// Extracts clues and determines which are unanswered

(function() {
  'use strict';

  console.log('[Crossword Trainer] Content script loaded');

  // Listen for messages from the popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[Crossword Trainer] Received message:', request);
    if (request.action === 'extractClues') {
      const result = extractUnansweredClues();
      console.log('[Crossword Trainer] Extraction result:', result);
      sendResponse(result);
    }
    return true;
  });

  function extractUnansweredClues() {
    console.log('[Crossword Trainer] Starting extraction...');

    // Check if we're on a valid crossword page
    if (!isNYTCrosswordPage()) {
      console.log('[Crossword Trainer] Not on crossword page');
      return { error: 'Not on a NYT crossword puzzle page' };
    }
    console.log('[Crossword Trainer] On valid crossword page');

    try {
      console.log('[Crossword Trainer] Extracting grid state...');
      const gridData = extractGridState();
      console.log('[Crossword Trainer] Grid:', gridData);

      console.log('[Crossword Trainer] Extracting clues...');
      const clues = extractClues();
      console.log('[Crossword Trainer] Clues:', clues);
      const unansweredClues = filterUnansweredClues(clues, gridData);

      // Extract puzzle date from URL
      const puzzleDate = extractPuzzleDate();

      return {
        success: true,
        puzzleDate,
        across: unansweredClues.across,
        down: unansweredClues.down,
        totalUnanswered: unansweredClues.across.length + unansweredClues.down.length,
        totalClues: clues.across.length + clues.down.length
      };
    } catch (e) {
      return { error: 'Failed to extract clues: ' + e.message };
    }
  }

  function isNYTCrosswordPage() {
    // Check for crossword game board elements
    return document.querySelector('[class*="Cell-"]') !== null ||
           document.querySelector('[class*="cell"]') !== null ||
           document.querySelector('.xwd__cell') !== null;
  }

  function extractPuzzleDate() {
    // Extract date from URL like /crosswords/game/daily/2010/07/24
    const match = window.location.pathname.match(/\/(\d{4})\/(\d{2})\/(\d{2})/);
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]}`;
    }
    // Fallback to today's date
    return new Date().toISOString().split('T')[0];
  }

  function extractGridState() {
    // Build a 2D grid representation with cell contents
    // NYT crossword uses an SVG-based grid or React components

    const grid = {
      cells: [],      // Flat array of cells in row-major order
      size: 0,        // Grid dimension (typically 15x15 or 21x21)
      cellsByNumber: new Map(), // Map clue number -> {row, col}
      getCell: function(row, col) {
        if (row < 0 || row >= this.size || col < 0 || col >= this.size) return null;
        return this.cells[row * this.size + col];
      }
    };

    // Try SVG-based grid first (newer NYT layout)
    const svgCells = document.querySelectorAll('g[data-group="cells"] g.xwd__cell');
    if (svgCells.length > 0) {
      console.log('[Crossword Trainer] Found', svgCells.length, 'SVG cells');
      return extractSVGGrid(grid, svgCells);
    }

    // Try React-based grid
    const reactCells = document.querySelectorAll('[class*="Cell-block"], [class*="cell-block"]');
    if (reactCells.length > 0) {
      return extractReactGrid(grid, reactCells);
    }

    // Fallback: try generic cell selectors
    const genericCells = document.querySelectorAll('[class*="Cell"], .xwd__cell');
    if (genericCells.length > 0) {
      return extractGenericGrid(grid, genericCells);
    }

    return grid;
  }

  function extractSVGGrid(grid, svgCells) {
    // Parse SVG cells - NYT uses g.xwd__cell elements with rect and text children
    const cellData = [];
    const cellSize = 33; // NYT uses 33px cells (plus 3px offset)

    svgCells.forEach(cell => {
      const rect = cell.querySelector('rect');
      if (!rect) return;

      // Get position from rect x/y attributes
      const x = parseFloat(rect.getAttribute('x') || '0');
      const y = parseFloat(rect.getAttribute('y') || '0');

      // Calculate row/col (accounting for 3px offset)
      const col = Math.round((x - 3) / cellSize);
      const row = Math.round((y - 3) / cellSize);

      // Check if this is a black cell
      const isBlack = rect.classList.contains('xwd__cell--block');

      // Get the cell number and letter from text elements
      let cellNumber = null;
      let letter = null;

      const texts = cell.querySelectorAll('text[data-testid="cell-text"]');
      texts.forEach(text => {
        const fontSize = parseFloat(text.getAttribute('font-size') || '0');

        // Get only the direct text content, not nested elements
        let content = '';
        text.childNodes.forEach(node => {
          if (node.nodeType === Node.TEXT_NODE) {
            content += node.textContent;
          }
        });
        content = content.trim();

        // Small font (~11) is the cell number, larger font (14-22) is the answer letter
        // Rebus cells use smaller font (~14.67) to fit multiple letters
        if (fontSize > 12 && content.length >= 1 && /^[A-Z]+$/i.test(content)) {
          letter = content.toUpperCase();
        } else if (fontSize <= 12 && /^\d+$/.test(content)) {
          cellNumber = parseInt(content, 10);
        }
      });

      cellData.push({ row, col, isBlack, cellNumber, letter });
    });

    // If no cells found, return empty grid
    if (cellData.length === 0) {
      return grid;
    }

    // Determine grid size
    const maxRow = Math.max(...cellData.map(c => c.row));
    const maxCol = Math.max(...cellData.map(c => c.col));
    grid.size = Math.max(maxRow, maxCol) + 1;

    // Sanity check
    if (grid.size <= 0 || grid.size > 25) {
      grid.size = 15; // Default to standard size
    }

    // Initialize grid cells
    grid.cells = new Array(grid.size * grid.size).fill(null).map(() => ({
      isBlack: false,
      letter: null,
      cellNumber: null
    }));

    // Populate grid
    cellData.forEach(({ row, col, isBlack, cellNumber, letter }) => {
      const idx = row * grid.size + col;
      if (idx >= 0 && idx < grid.cells.length) {
        grid.cells[idx] = { isBlack, letter, cellNumber };
        if (cellNumber) {
          grid.cellsByNumber.set(cellNumber, { row, col });
        }
      }
    });

    return grid;
  }

  function extractReactGrid(grid, reactCells) {
    // React-based grid - cells are typically in DOM order (row-major)
    const cellCount = reactCells.length;
    if (cellCount === 0) return grid;

    grid.size = Math.sqrt(cellCount);

    if (!Number.isInteger(grid.size)) {
      // Try common sizes
      if (cellCount === 225) grid.size = 15;
      else if (cellCount === 441) grid.size = 21;
      else grid.size = Math.ceil(Math.sqrt(cellCount));
    }

    // Sanity check
    if (grid.size <= 0 || grid.size > 25) {
      grid.size = 15;
    }

    grid.cells = [];

    reactCells.forEach((cell, idx) => {
      const row = Math.floor(idx / grid.size);
      const col = idx % grid.size;

      // Check for black cell
      const isBlack = cell.classList.contains('black') ||
                      cell.querySelector('[class*="block"]') !== null ||
                      cell.getAttribute('aria-label')?.includes('black');

      // Get letter content
      let letter = null;
      const letterEl = cell.querySelector('[class*="letter"], [class*="guess"]');
      if (letterEl) {
        const content = letterEl.textContent.trim();
        if (content.length === 1 && /[A-Z]/i.test(content)) {
          letter = content.toUpperCase();
        }
      } else {
        // Try direct text content
        const texts = cell.querySelectorAll('text, span');
        texts.forEach(t => {
          const content = t.textContent.trim();
          if (content.length === 1 && /[A-Z]/i.test(content)) {
            letter = content.toUpperCase();
          }
        });
      }

      // Get cell number
      let cellNumber = null;
      const numEl = cell.querySelector('[class*="label"], [class*="number"]');
      if (numEl) {
        const num = parseInt(numEl.textContent.trim(), 10);
        if (!isNaN(num)) {
          cellNumber = num;
          grid.cellsByNumber.set(cellNumber, { row, col });
        }
      }

      grid.cells.push({ isBlack, letter, cellNumber });
    });

    return grid;
  }

  function extractGenericGrid(grid, cells) {
    const cellCount = cells.length;
    if (cellCount === 0) return grid;

    grid.size = Math.sqrt(cellCount);

    if (!Number.isInteger(grid.size)) {
      if (cellCount === 225) grid.size = 15;
      else if (cellCount === 441) grid.size = 21;
      else grid.size = Math.ceil(Math.sqrt(cellCount));
    }

    // Sanity check
    if (grid.size <= 0 || grid.size > 25) {
      grid.size = 15;
    }

    grid.cells = [];

    cells.forEach((cell, idx) => {
      const row = Math.floor(idx / grid.size);
      const col = idx % grid.size;

      const text = cell.textContent.trim();
      const isBlack = cell.classList.contains('black') ||
                      cell.classList.contains('xwd__cell--block');

      let letter = null;
      let cellNumber = null;

      // Parse text content - might contain both number and letter
      const parts = text.match(/^(\d+)?([A-Z])?$/i);
      if (parts) {
        if (parts[1]) {
          cellNumber = parseInt(parts[1], 10);
          grid.cellsByNumber.set(cellNumber, { row, col });
        }
        if (parts[2]) {
          letter = parts[2].toUpperCase();
        }
      }

      grid.cells.push({ isBlack, letter, cellNumber });
    });

    return grid;
  }

  function getAnswerPattern(clueNumber, direction, grid) {
    // Find the starting cell for this clue
    const startPos = grid.cellsByNumber.get(clueNumber);
    if (!startPos) return null;

    const { row, col } = startPos;
    const pattern = [];

    // Traverse in the appropriate direction until hitting a black cell or edge
    let r = row, c = col;

    while (r < grid.size && c < grid.size) {
      const cell = grid.getCell(r, c);
      if (!cell || cell.isBlack) break;

      pattern.push(cell.letter || '_');

      if (direction === 'across') {
        c++;
      } else {
        r++;
      }
    }

    return pattern.join('');
  }

  function isPatternComplete(pattern) {
    return pattern && !pattern.includes('_');
  }

  function extractClues() {
    const across = [];
    const down = [];

    // Try multiple selector patterns for NYT crossword clues
    const clueSelectors = [
      '.xwd__clue--li',
      '[class*="Clue-li"]',
      '[class*="clue-"]',
      'li[class*="clue"]',
      '.ClueList-wrapper li'
    ];

    let clueElements = [];
    for (const selector of clueSelectors) {
      clueElements = document.querySelectorAll(selector);
      if (clueElements.length > 0) break;
    }

    // If still no clues found, try finding clue lists by structure
    if (clueElements.length === 0) {
      // Look for Across/Down section headers and extract clues from their siblings
      const acrossSection = findClueSection('across');
      const downSection = findClueSection('down');

      if (acrossSection) {
        extractCluesFromSection(acrossSection, across);
      }
      if (downSection) {
        extractCluesFromSection(downSection, down);
      }
    } else {
      // Parse found clue elements
      clueElements.forEach(element => {
        const clueData = parseClueElement(element);
        if (clueData) {
          // Determine if Across or Down based on parent section
          const direction = getClueDirection(element);
          if (direction === 'down') {
            down.push(clueData);
          } else {
            across.push(clueData);
          }
        }
      });
    }

    // Alternative parsing: Look for clue containers with labels
    if (across.length === 0 && down.length === 0) {
      parseCluesByAriaLabels(across, down);
    }

    return { across, down };
  }

  function findClueSection(direction) {
    const labels = document.querySelectorAll('h3, h4, [class*="Header"], [class*="title"]');
    for (const label of labels) {
      if (label.textContent.toLowerCase().includes(direction)) {
        return label.parentElement || label.nextElementSibling;
      }
    }
    return null;
  }

  function extractCluesFromSection(section, clueArray) {
    const items = section.querySelectorAll('li, [role="listitem"]');
    items.forEach(item => {
      const clueData = parseClueElement(item);
      if (clueData) {
        clueArray.push(clueData);
      }
    });
  }

  function parseClueElement(element) {
    // Extract clue number
    const numberEl = element.querySelector('[class*="label"], [class*="number"], .xwd__clue--label');
    const textEl = element.querySelector('[class*="text"], .xwd__clue--text');

    let number, text;

    if (numberEl && textEl) {
      number = numberEl.textContent.trim();
      text = textEl.textContent.trim();
    } else {
      // Try to parse from full text: "1. Clue text here"
      const fullText = element.textContent.trim();
      const match = fullText.match(/^(\d+)[.\s]+(.+)$/);
      if (match) {
        number = match[1];
        text = match[2];
      } else {
        return null;
      }
    }

    // Get associated cells if available (from data attributes)
    const cells = element.dataset.cells || element.getAttribute('data-cells') || '';

    return {
      number: parseInt(number, 10),
      text: text,
      cells: cells.split(',').filter(c => c).map(c => parseInt(c, 10)),
      element: element
    };
  }

  function getClueDirection(element) {
    // Walk up the DOM tree to find direction indicators
    let parent = element.parentElement;
    while (parent) {
      const className = (parent.className || '').toString();
      const ariaLabel = parent.getAttribute('aria-label') || '';
      const textContent = parent.querySelector('h3, h4, [class*="Header"], [class*="title"]');
      const headerText = textContent ? textContent.textContent.toLowerCase() : '';

      // Check class names
      if (/down/i.test(className)) {
        return 'down';
      }
      if (/across/i.test(className)) {
        return 'across';
      }

      // Check aria labels
      if (/down/i.test(ariaLabel)) {
        return 'down';
      }
      if (/across/i.test(ariaLabel)) {
        return 'across';
      }

      // Check section headers
      if (headerText.includes('down')) {
        return 'down';
      }
      if (headerText.includes('across')) {
        return 'across';
      }

      // Check data attributes
      const dataDirection = parent.getAttribute('data-direction');
      if (dataDirection) {
        return dataDirection.toLowerCase();
      }

      parent = parent.parentElement;
    }

    // As a fallback, check the element's own text or attributes
    const elementText = element.textContent || '';
    if (/down/i.test(element.getAttribute('aria-label') || '')) {
      return 'down';
    }

    return 'across'; // Default to across if can't determine
  }

  function parseCluesByAriaLabels(across, down) {
    // NYT often uses aria-labels for accessibility
    document.querySelectorAll('[aria-label]').forEach(el => {
      const label = el.getAttribute('aria-label');
      const acrossMatch = label.match(/^(\d+)\s+across[:\s]+(.+)$/i);
      const downMatch = label.match(/^(\d+)\s+down[:\s]+(.+)$/i);

      if (acrossMatch) {
        across.push({
          number: parseInt(acrossMatch[1], 10),
          text: acrossMatch[2],
          cells: [],
          element: el
        });
      } else if (downMatch) {
        down.push({
          number: parseInt(downMatch[1], 10),
          text: downMatch[2],
          cells: [],
          element: el
        });
      }
    });
  }

  function filterUnansweredClues(clues, grid) {
    const unansweredAcross = [];
    const unansweredDown = [];

    clues.across.forEach(clue => {
      const pattern = getAnswerPattern(clue.number, 'across', grid);
      // Include if pattern is incomplete, or if we couldn't determine pattern
      if (!pattern || !isPatternComplete(pattern)) {
        unansweredAcross.push({
          number: clue.number,
          text: clue.text,
          direction: 'across',
          pattern: pattern || null
        });
      }
    });

    clues.down.forEach(clue => {
      const pattern = getAnswerPattern(clue.number, 'down', grid);
      // Include if pattern is incomplete, or if we couldn't determine pattern
      if (!pattern || !isPatternComplete(pattern)) {
        unansweredDown.push({
          number: clue.number,
          text: clue.text,
          direction: 'down',
          pattern: pattern || null
        });
      }
    });

    return {
      across: unansweredAcross,
      down: unansweredDown
    };
  }

  function isClueFullyAnswered(clue) {
    // Check if the clue's element has any indication of being complete
    const element = clue.element;
    if (!element) return false;

    // Check for "correct" or "filled" class indicators
    const className = element.className || '';
    if (/correct|complete|filled|solved/i.test(className)) {
      return true;
    }

    // Check if clue is highlighted as incomplete
    if (/incomplete|empty|unfilled/i.test(className)) {
      return false;
    }

    // Try to find the associated cells and check their fill state
    // This requires mapping clue numbers to grid positions
    const clueNumber = clue.number;

    // Find cells that start with this clue number
    const cellsWithNumber = document.querySelectorAll(`[data-cell-number="${clueNumber}"], [aria-label*="${clueNumber}"]`);

    // Alternative: Check the crossword grid directly
    // Look for cells associated with this clue
    const gridCells = findCellsForClue(clue);

    if (gridCells.length > 0) {
      // Check if all cells have letters
      return gridCells.every(cell => {
        const text = cell.textContent.trim();
        // Cell is filled if it contains a single letter
        return /^[A-Z]$/i.test(text);
      });
    }

    // If we can't determine, assume unanswered
    return false;
  }

  function findCellsForClue(clue) {
    const cells = [];

    // Try to find by clue number in the grid
    // NYT crossword cells often have the clue number as a small label
    const allCells = document.querySelectorAll('[class*="Cell"], .xwd__cell');

    allCells.forEach(cell => {
      // Check if this cell has the clue number
      const labelEl = cell.querySelector('[class*="label"], .xwd__cell--label');
      if (labelEl && labelEl.textContent.trim() === String(clue.number)) {
        // This is the starting cell - would need to find subsequent cells
        // based on direction (across = same row, down = same column)
        cells.push(cell);
      }
    });

    return cells;
  }

  // Expose for testing
  window.__crosswordTrainer = {
    extractUnansweredClues,
    extractClues,
    extractGridState
  };

})();
