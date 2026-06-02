/**
 * Sets up keyboard navigation for an array of letter input elements.
 * Handles: uppercase enforcement, backspace/arrow navigation, focus→select.
 *
 * @param {HTMLInputElement[]} inputs - ordered array of input elements
 * @param {object} [options]
 * @param {function} [options.onInput]  - called after uppercase is applied: (input, idx, val, event)
 * @param {function} [options.onEnter] - called when Enter is pressed: (idx, event)
 */
function setupLetterInputNavigation(inputs, { onInput, onEnter } = {}) {
  inputs.forEach((input, idx) => {
    input.addEventListener('input', (e) => {
      const val = e.target.value.toUpperCase();
      e.target.value = val;
      if (onInput) onInput(input, idx, val, e);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !e.target.value && idx > 0) {
        inputs[idx - 1].focus();
        inputs[idx - 1].select();
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        inputs[idx - 1].focus();
      } else if (e.key === 'ArrowRight' && idx < inputs.length - 1) {
        inputs[idx + 1].focus();
      } else if (e.key === 'Enter' && onEnter) {
        onEnter(idx, e);
      }
    });

    input.addEventListener('focus', () => input.select());
  });
}
