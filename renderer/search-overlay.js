import { searchChannels } from './search.js';

/**
 * Full-screen channel search for viewing from across the room. The sidebar box
 * is sized for a desk; on a TV its text and rows are too small to read.
 *
 * Lives inside #player-area because fullscreen is requested on that element —
 * anything outside it is not drawn while fullscreen, which is how TV users watch.
 *
 * Rows come from the caller's buildRow, so a result behaves exactly like the
 * same channel in the sidebar (play, favourite, open series). The overlay only
 * adds keyboard focus and closes itself once a row is picked.
 */
export function createSearchOverlay({ root, input, list, status, getChannels, isVisible, buildRow, limit = 100 }) {
  let focusIndex = -1;
  let renderTimer = null;

  const rows = () => [...list.querySelectorAll('.channel-item')];

  function isOpen() {
    return !root.classList.contains('hidden');
  }

  function open() {
    root.classList.remove('hidden');
    input.value = '';
    render();
    input.focus();
  }

  function close() {
    clearTimeout(renderTimer);
    renderTimer = null;
    root.classList.add('hidden');
    list.innerHTML = '';
    input.blur();
  }

  function render() {
    clearTimeout(renderTimer);
    renderTimer = null;
    focusIndex = -1;
    list.innerHTML = '';
    const query = input.value;
    const { results, total } = searchChannels(getChannels(), query, isVisible, limit);

    if (!query.trim()) {
      status.textContent = 'Type a channel name';
    } else if (total === 0) {
      status.textContent = 'No channels match your search';
    } else if (total > results.length) {
      status.textContent = `Showing ${results.length} of ${total} — type more to narrow it down`;
    } else {
      status.textContent = total === 1 ? '1 channel' : `${total} channels`;
    }

    const frag = document.createDocumentFragment();
    results.forEach((c) => frag.appendChild(buildRow(c)));
    list.appendChild(frag);
    list.scrollTop = 0;
  }

  function moveFocus(delta) {
    const all = rows();
    if (all.length === 0) return;
    all.forEach((r) => r.classList.remove('kbd-focus'));
    focusIndex = focusIndex < 0 ? 0 : Math.max(0, Math.min(all.length - 1, focusIndex + delta));
    all[focusIndex].classList.add('kbd-focus');
    all[focusIndex].scrollIntoView({ block: 'nearest' });
  }

  input.addEventListener('input', () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 150);
  });

  // Focus stays in the input the whole time, so typing more never needs a click
  // back; the arrows move a highlight through the results instead.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveFocus(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // A pending debounce means the visible rows are for an older query.
      if (renderTimer) render();
      // Type a name and press Enter: the top match is almost always the one.
      const row = rows()[Math.max(focusIndex, 0)];
      if (row) row.click();
    }
  });

  // Row handlers run first (they are on the row); this closes once a row is
  // picked. The star only toggles a favourite, so the overlay stays up for it.
  list.addEventListener('click', (e) => {
    if (e.target.closest('.fav-btn')) {
      input.focus();
      return;
    }
    if (e.target.closest('.channel-item')) close();
  });

  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });

  return { open, close, isOpen };
}
