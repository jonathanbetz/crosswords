// Popup script for Crossword Trainer extension

const API_BASE_URL = 'https://crosswords-ten.vercel.app';

document.addEventListener('DOMContentLoaded', () => {
  const statusDiv = document.getElementById('status');
  const errorDiv = document.getElementById('error');
  const errorMessage = document.getElementById('errorMessage');

  // Automatically extract and save on popup open
  extractAndSave();

  async function extractAndSave() {
    statusDiv.innerHTML = '<p>Extracting clues...</p>';

    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Check if we're on a NYT crossword page
      if (!tab.url.includes('nytimes.com/crosswords')) {
        throw new Error('Please navigate to a NYT crossword puzzle page first.');
      }

      // Try to send message to content script
      let results;
      try {
        results = await chrome.tabs.sendMessage(tab.id, { action: 'extractClues' });
      } catch (err) {
        // Content script not loaded, inject it
        if (err.message.includes('Receiving end does not exist')) {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
          });
          results = await chrome.tabs.sendMessage(tab.id, { action: 'extractClues' });
        } else {
          throw err;
        }
      }

      if (results.error) {
        throw new Error(results.error);
      }

      if (results.totalUnanswered === 0) {
        statusDiv.innerHTML = '<p>No unanswered clues found.</p>';
        return;
      }

      // Save to server
      statusDiv.innerHTML = '<p>Saving clues...</p>';

      const payload = {
        puzzleDate: results.puzzleDate,
        clues: [
          ...results.across.map(c => ({
            number: c.number,
            direction: 'across',
            text: c.text,
            pattern: c.pattern
          })),
          ...results.down.map(c => ({
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

      statusDiv.innerHTML = `<p><strong>${results.totalUnanswered} clues saved</strong></p><p class="date">${results.puzzleDate}</p>`;

    } catch (err) {
      showError(err.message || 'An unexpected error occurred.');
    }
  }

  function showError(message) {
    errorMessage.textContent = message;
    errorDiv.classList.remove('hidden');
    statusDiv.innerHTML = '';
  }
});
