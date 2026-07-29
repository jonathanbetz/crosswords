// Shared header stat strip: shows how much work remains across all puzzles
// (unsolved puzzles, clues, and squares). Included on every page so the numbers
// are always visible. Self-initializing: on DOMContentLoaded it inserts the
// strip below the page header and fetches the stats — unless the page sets
// window.HEADER_STATS_MANUAL = true, in which case it renders whatever stats the
// page passes to HeaderStats.render() (avoids a duplicate fetch on pages that
// already load /api/clues).
(function () {
  const STYLE_ID = 'header-stats-style';
  const CONTAINER_ID = 'headerStats';

  const CSS = `
    .header-stats {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin: 0 0 30px;
    }
    .header-stats .stat {
      flex: 1;
      min-width: 120px;
      background: white;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      text-align: center;
    }
    .header-stats .stat-value {
      display: block;
      font-size: 24px;
      font-weight: 700;
      color: #dc3545;
      line-height: 1.1;
    }
    .header-stats .stat-value.zero { color: #28a745; }
    .header-stats .stat-label {
      display: block;
      margin-top: 4px;
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
  `;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  // Find (or create) the strip element, placed right below the page header.
  function ensureContainer() {
    let el = document.getElementById(CONTAINER_ID);
    if (el) return el;

    el = document.createElement('div');
    el.id = CONTAINER_ID;
    el.className = 'header-stats';
    el.style.display = 'none';

    const subtitle = document.querySelector('p.subtitle');
    const header = document.querySelector('header');
    const anchor = subtitle || header;
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(el, anchor.nextSibling);
    } else {
      document.body.insertBefore(el, document.body.firstChild);
    }
    return el;
  }

  function render(stats) {
    injectStyle();
    const el = ensureContainer();
    if (!stats) {
      el.style.display = 'none';
      return;
    }
    const fmt = n => (n || 0).toLocaleString();
    const cls = n => (n ? '' : ' zero');
    el.innerHTML = `
      <div class="stat">
        <span class="stat-value${cls(stats.unsolvedPuzzles)}">${fmt(stats.unsolvedPuzzles)}</span>
        <span class="stat-label">Puzzles unsolved</span>
      </div>
      <div class="stat">
        <span class="stat-value${cls(stats.unsolvedClues)}">${fmt(stats.unsolvedClues)}</span>
        <span class="stat-label">Clues remaining</span>
      </div>
      <div class="stat">
        <span class="stat-value${cls(stats.unsolvedSquares)}">${fmt(stats.unsolvedSquares)}</span>
        <span class="stat-label">Squares remaining</span>
      </div>`;
    el.style.display = 'flex';
  }

  async function fetchAndRender() {
    try {
      const res = await fetch('/api/clues?statsOnly=true');
      if (!res.ok) return;
      const data = await res.json();
      render(data.stats);
    } catch (e) {
      // Non-critical UI; fail silently.
    }
  }

  window.HeaderStats = { render, fetchAndRender };

  document.addEventListener('DOMContentLoaded', () => {
    if (!window.HEADER_STATS_MANUAL) fetchAndRender();
  });
})();
