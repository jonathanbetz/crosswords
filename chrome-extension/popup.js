// Popup script for Crossword Trainer extension

const API_BASE_URL = 'https://backend-ewd3vb232-jonathan-betzs-projects.vercel.app';

document.addEventListener('DOMContentLoaded', () => {
  const extractBtn = document.getElementById('extractBtn');
  const resultsDiv = document.getElementById('results');
  const errorDiv = document.getElementById('error');
  const errorMessage = document.getElementById('errorMessage');
  const statusDiv = document.getElementById('status');
  const clueCount = document.getElementById('clueCount');
  const puzzleDateEl = document.getElementById('puzzleDate');
  const acrossClues = document.getElementById('acrossClues');
  const downClues = document.getElementById('downClues');
  const copyBtn = document.getElementById('copyBtn');
  const saveBtn = document.getElementById('saveBtn');

  let lastResults = null;

  extractBtn.addEventListener('click', async () => {
    // Reset UI
    resultsDiv.classList.add('hidden');
    errorDiv.classList.add('hidden');
    extractBtn.disabled = true;
    extractBtn.textContent = 'Extracting...';
    statusDiv.innerHTML = '<p>Scanning puzzle...</p>';

    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Check if we're on a NYT crossword page
      if (!tab.url.includes('nytimes.com/crosswords')) {
        throw new Error('Please navigate to a NYT crossword puzzle page first.');
      }

      // Inject content script if not already present and send message
      const results = await chrome.tabs.sendMessage(tab.id, { action: 'extractClues' });

      if (results.error) {
        throw new Error(results.error);
      }

      // Store results for copy functionality
      lastResults = results;

      // Display results
      displayResults(results);

    } catch (err) {
      // Handle case where content script isn't loaded
      if (err.message.includes('Receiving end does not exist')) {
        // Try injecting the content script manually
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          // Retry the extraction
          const results = await chrome.tabs.sendMessage(tab.id, { action: 'extractClues' });
          if (results.error) {
            throw new Error(results.error);
          }
          lastResults = results;
          displayResults(results);
        } catch (retryErr) {
          showError(retryErr.message || 'Failed to extract clues. Make sure you\'re on a NYT crossword page.');
        }
      } else {
        showError(err.message || 'An unexpected error occurred.');
      }
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = 'Extract Clues';
    }
  });

  copyBtn.addEventListener('click', () => {
    if (!lastResults) return;

    const text = formatCluesForClipboard(lastResults);
    navigator.clipboard.writeText(text).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy to Clipboard';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  });

  saveBtn.addEventListener('click', async () => {
    if (!lastResults) return;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const payload = {
        puzzleDate: lastResults.puzzleDate,
        clues: [
          ...lastResults.across.map(c => ({
            number: c.number,
            direction: 'across',
            text: c.text,
            pattern: c.pattern
          })),
          ...lastResults.down.map(c => ({
            number: c.number,
            direction: 'down',
            text: c.text,
            pattern: c.pattern
          }))
        ]
      };

      const response = await fetch(`${API_BASE_URL}/api/clues`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save');
      }

      saveBtn.textContent = 'Saved!';
      setTimeout(() => {
        saveBtn.textContent = 'Save to Server';
        saveBtn.disabled = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to save:', err);
      saveBtn.textContent = 'Save Failed';
      setTimeout(() => {
        saveBtn.textContent = 'Save to Server';
        saveBtn.disabled = false;
      }, 2000);
    }
  });

  function displayResults(results) {
    statusDiv.innerHTML = `<p>Found ${results.totalClues} total clues.</p>`;
    clueCount.textContent = results.totalUnanswered;
    puzzleDateEl.textContent = results.puzzleDate || 'Unknown';

    // Clear previous results
    acrossClues.innerHTML = '';
    downClues.innerHTML = '';

    // Populate across clues
    results.across.forEach(clue => {
      const li = document.createElement('li');
      const patternHtml = clue.pattern ? `<span class="clue-pattern">${escapeHtml(clue.pattern)}</span>` : '';
      li.innerHTML = `<span class="clue-number">${clue.number}.</span> <span class="clue-text">${escapeHtml(clue.text)}</span>${patternHtml}`;
      acrossClues.appendChild(li);
    });

    // Populate down clues
    results.down.forEach(clue => {
      const li = document.createElement('li');
      const patternHtml = clue.pattern ? `<span class="clue-pattern">${escapeHtml(clue.pattern)}</span>` : '';
      li.innerHTML = `<span class="clue-number">${clue.number}.</span> <span class="clue-text">${escapeHtml(clue.text)}</span>${patternHtml}`;
      downClues.appendChild(li);
    });

    resultsDiv.classList.remove('hidden');
    errorDiv.classList.add('hidden');
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorDiv.classList.remove('hidden');
    resultsDiv.classList.add('hidden');
    statusDiv.innerHTML = '<p>Extraction failed.</p>';
  }

  function formatCluesForClipboard(results) {
    let text = `UNANSWERED CROSSWORD CLUES - ${results.puzzleDate || 'Unknown Date'}\n`;
    text += '=' .repeat(30) + '\n\n';

    if (results.across.length > 0) {
      text += 'ACROSS\n';
      text += '-'.repeat(20) + '\n';
      results.across.forEach(clue => {
        const pattern = clue.pattern ? ` [${clue.pattern}]` : '';
        text += `${clue.number}. ${clue.text}${pattern}\n`;
      });
      text += '\n';
    }

    if (results.down.length > 0) {
      text += 'DOWN\n';
      text += '-'.repeat(20) + '\n';
      results.down.forEach(clue => {
        const pattern = clue.pattern ? ` [${clue.pattern}]` : '';
        text += `${clue.number}. ${clue.text}${pattern}\n`;
      });
    }

    return text;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
});
