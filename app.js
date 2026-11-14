/*
 * app.js — Flashcards Study App (vanilla JS, no build step).
 *
 * Structure:
 *   1. State + element lookups
 *   2. Helpers (ids, lookups, validation, announcements)
 *   3. View model (order / search / current card)
 *   4. Rendering (small functions; all user text goes through textContent, never innerHTML)
 *   5. Actions (deck CRUD, card CRUD, study navigation, import/export)
 *   6. Modal (focus trap, Esc, return focus)
 *   7. Event wiring — every listener is bound exactly once; clicks use one delegated handler
 */
(function () {
  'use strict';

  const { loadState, saveState, hasSavedState, parseImport, STORAGE_KEY, MAX_NAME, MAX_TEXT, DECK_COLORS } = window.FlashStorage;

  /* ---------------------------------------------------------------- 1. State */

  const isFirstVisit = !hasSavedState();
  const state = loadState(); // { decks, cardsByDeckId, activeDeckId } — persisted

  // Transient UI state — never persisted, never mixed into `state`.
  const ui = {
    query: '',          // current (debounced) search text
    order: [],          // card ids in study order for the active deck (shuffle reorders this, not the data)
    index: 0,           // position within the *visible* (filtered) cards
    isFlipped: false,
    isShuffled: false,
    isModalOpen: false,
    seen: new Set(),    // card ids viewed this session (per deck)
    flips: 0,           // flips this session (per deck)
  };

  const $ = (sel) => document.querySelector(sel);
  const els = {
    app: $('#app'),
    main: $('#main'),
    deckList: $('#deck-list'),
    deckEmpty: $('#deck-empty'),
    noDeck: $('#no-deck'),
    deckView: $('#deck-view'),
    deckTitle: $('#deck-title'),
    deckMeta: $('#deck-meta'),
    search: $('#search-input'),
    searchCount: $('#search-count'),
    shuffleBtn: $('#shuffle-btn'),
    studyEmptyDeck: $('#study-empty-deck'),
    studyEmptySearch: $('#study-empty-search'),
    studyArea: $('#study-area'),
    position: $('#study-position'),
    progressFill: $('#progress-fill'),
    cardInner: $('#card-inner'),
    frontFace: $('#card-front-face'),
    backFace: $('#card-back-face'),
    frontText: $('#card-front-text'),
    backText: $('#card-back-text'),
    prevBtn: $('#prev-btn'),
    nextBtn: $('#next-btn'),
    flipBtn: $('#flip-btn'),
    editCurrentBtn: $('#edit-current-btn'),
    deleteCurrentBtn: $('#delete-current-btn'),
    cardListSection: $('#card-list-section'),
    cardsHeading: $('#cards-heading'),
    cardList: $('#card-list'),
    importInput: $('#import-input'),
    announcer: $('#announcer'),
    toastRegion: $('#toast-region'),
    studyCard: $('#study-card'),
    statTotal: $('#stat-total'),
    statSeen: $('#stat-seen'),
    statFlips: $('#stat-flips'),
    modalRoot: $('#modal-root'),
    modalTitle: $('#modal-title'),
    modalDesc: $('#modal-desc'),
    modalForm: $('#modal-form'),
    modalFields: $('#modal-fields'),
    modalError: $('#modal-error'),
    modalCancel: $('#modal-cancel'),
    modalSubmit: $('#modal-submit'),
  };

  /* -------------------------------------------------------------- 2. Helpers */

  function uid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const activeDeck = () => state.decks.find((d) => d.id === state.activeDeckId) || null;
  const cardsOf = (deckId) => state.cardsByDeckId[deckId] || [];
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  function announce(message) {
    // Clear first so repeating the same message is still announced.
    els.announcer.textContent = '';
    requestAnimationFrame(() => { els.announcer.textContent = message; });
  }

  /** Announce to screen readers AND show a little visual toast. */
  function notify(message) {
    announce(message);
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    els.toastRegion.append(toast);
    // Cap the stack at 3 so rapid actions don't pile up.
    while (els.toastRegion.children.length > 3) els.toastRegion.firstElementChild.remove();
    setTimeout(() => {
      toast.classList.add('toast--leaving');
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  function persist() {
    if (!saveState(state)) {
      announce('Could not save. Browser storage may be full or turned off.');
    }
  }

  function validateDeckName(raw, excludeId = null) {
    const name = raw.trim();
    if (!name) return 'Give the deck a name.';
    if (name.length > MAX_NAME) return `Keep deck names under ${MAX_NAME} characters.`;
    const clash = state.decks.some((d) => d.id !== excludeId && d.name.toLowerCase() === name.toLowerCase());
    if (clash) return 'You already have a deck with that name.';
    return null;
  }

  function uniqueDeckName(base) {
    let name = base.slice(0, MAX_NAME);
    let n = 2;
    while (validateDeckName(name)) {
      const suffix = ` (${n++})`;
      name = base.slice(0, MAX_NAME - suffix.length) + suffix;
    }
    return name;
  }

  /* ----------------------------------------------------------- 3. View model */

  /** Keep ui.order in step with the deck's cards without losing a shuffled order. */
  function syncOrder() {
    const deck = activeDeck();
    if (!deck) { ui.order = []; return; }
    const ids = cardsOf(deck.id).map((c) => c.id);
    const exists = new Set(ids);
    const kept = ui.order.filter((id) => exists.has(id));
    const keptSet = new Set(kept);
    ui.order = kept.concat(ids.filter((id) => !keptSet.has(id)));
  }

  /** Cards to show/study: study order + search filter. Never mutates the stored data. */
  function visibleCards() {
    const deck = activeDeck();
    if (!deck) return [];
    const byId = new Map(cardsOf(deck.id).map((c) => [c.id, c]));
    const q = ui.query.trim().toLowerCase();
    return ui.order
      .map((id) => byId.get(id))
      .filter((c) => c && (!q || c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)));
  }

  /* ------------------------------------------------------------- 4. Rendering */

  function render() {
    syncOrder();
    renderDecks();
    renderDeckView();
  }

  function renderDecks() {
    const items = state.decks.map((deck) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'deck-item';
      btn.dataset.action = 'select-deck';
      btn.dataset.deckId = deck.id;
      btn.dataset.color = deck.color;
      if (deck.id === state.activeDeckId) btn.setAttribute('aria-current', 'true');

      const name = document.createElement('span');
      name.className = 'deck-name';
      name.textContent = deck.name;

      const count = document.createElement('span');
      count.className = 'deck-count';
      const n = cardsOf(deck.id).length;
      count.textContent = String(n);
      const sr = document.createElement('span');
      sr.className = 'visually-hidden';
      sr.textContent = n === 1 ? ' card' : ' cards';
      count.append(sr);

      const dot = document.createElement('span');
      dot.className = 'deck-dot';
      dot.setAttribute('aria-hidden', 'true');

      btn.append(dot, name, count);
      li.append(btn);
      return li;
    });
    els.deckList.replaceChildren(...items);
    els.deckEmpty.hidden = state.decks.length > 0;
  }

  function renderDeckView() {
    const deck = activeDeck();
    els.noDeck.hidden = Boolean(deck);
    els.deckView.hidden = !deck;
    if (!deck) return;

    const total = cardsOf(deck.id).length;
    const visible = visibleCards();

    els.deckView.dataset.color = deck.color;
    els.deckTitle.textContent = deck.name;
    els.deckMeta.textContent = `${plural(total, 'card')} · created ${new Date(deck.createdAt).toLocaleDateString()}`;

    // Toolbar
    const q = ui.query.trim();
    els.statTotal.textContent = String(total);
    els.searchCount.textContent = q ? `${visible.length} of ${plural(total, 'card')} match` : '';
    els.search.disabled = total === 0;
    els.shuffleBtn.disabled = visible.length < 2;
    els.shuffleBtn.setAttribute('aria-pressed', String(ui.isShuffled));
    els.shuffleBtn.textContent = ui.isShuffled ? 'Shuffled ✓' : 'Shuffle';

    renderStudy();
    renderCardList();
  }

  function renderStudy() {
    const deck = activeDeck();
    if (!deck) return;
    const total = cardsOf(deck.id).length;
    const visible = visibleCards();

    els.studyEmptyDeck.hidden = total !== 0;
    els.studyEmptySearch.hidden = !(total > 0 && visible.length === 0);
    els.studyArea.hidden = visible.length === 0;
    if (!visible.length) return;

    ui.index = clamp(ui.index, 0, visible.length - 1);
    const card = visible[ui.index];

    els.frontText.textContent = card.front || '(blank)';
    els.backText.textContent = card.back || '(blank)';
    els.position.textContent = `Card ${ui.index + 1} of ${visible.length}`;
    els.progressFill.style.width = `${((ui.index + 1) / visible.length) * 100}%`;

    // Boundaries: Prev is disabled on the first card. On the last card, Next becomes "Start over".
    const isLast = ui.index === visible.length - 1;
    els.prevBtn.disabled = ui.index === 0;
    els.nextBtn.disabled = visible.length < 2;
    els.nextBtn.textContent = isLast && visible.length > 1 ? 'Start over ↺' : 'Next →';
    els.nextBtn.classList.toggle('is-restart', isLast && visible.length > 1);

    ui.seen.add(card.id);
    renderStats();

    applyFlipState();

    els.editCurrentBtn.dataset.cardId = card.id;
    els.deleteCurrentBtn.dataset.cardId = card.id;

    highlightCurrentInList();
  }

  function renderStats() {
    const deck = activeDeck();
    if (!deck) return;
    const ids = new Set(cardsOf(deck.id).map((c) => c.id));
    const seen = [...ui.seen].filter((id) => ids.has(id)).length;
    els.statSeen.textContent = `${seen}/${ids.size}`;
    els.statFlips.textContent = String(ui.flips);
  }

  function applyFlipState() {
    els.cardInner.classList.toggle('is-flipped', ui.isFlipped);
    els.flipBtn.setAttribute('aria-pressed', String(ui.isFlipped));
    els.flipBtn.textContent = ui.isFlipped ? 'Show front' : 'Flip';
    // Only the visible face is exposed to screen readers.
    els.frontFace.setAttribute('aria-hidden', String(ui.isFlipped));
    els.backFace.setAttribute('aria-hidden', String(!ui.isFlipped));
  }

  /**
   * Snap the card back to its front WITHOUT animating. If we just removed .is-flipped,
   * the card would visibly rotate back while already showing the next card's text — a spoiler.
   */
  function resetFlip() {
    ui.isFlipped = false;
    els.cardInner.classList.add('no-transition');
    els.cardInner.classList.remove('is-flipped');
    void els.cardInner.offsetWidth; // force reflow so the jump is committed before transitions return
    els.cardInner.classList.remove('no-transition');
  }

  function renderCardList() {
    const deck = activeDeck();
    const visible = visibleCards();
    els.cardListSection.hidden = visible.length === 0;
    if (!deck || !visible.length) { els.cardList.replaceChildren(); return; }

    els.cardsHeading.textContent = ui.query.trim()
      ? `Matching cards (${visible.length})`
      : `All cards (${visible.length})`;

    const items = visible.map((card, i) => {
      const li = document.createElement('li');
      li.className = 'card-row';
      li.dataset.cardId = card.id;

      const main = document.createElement('button');
      main.type = 'button';
      main.className = 'card-row-main';
      main.dataset.action = 'study-card';
      main.dataset.cardId = card.id;
      main.dataset.index = String(i);

      const front = document.createElement('span');
      front.className = 'card-row-front';
      front.textContent = card.front || '(blank)';
      const back = document.createElement('span');
      back.className = 'card-row-back';
      back.textContent = card.back || '(blank)';
      main.append(front, back);

      const label = truncate(card.front || 'blank card', 40);
      const edit = makeButton('Edit', 'edit-card', card.id, `Edit card: ${label}`, 'btn btn-ghost btn-sm');
      const del = makeButton('Delete', 'delete-card', card.id, `Delete card: ${label}`, 'btn btn-danger-ghost btn-sm');

      const actions = document.createElement('div');
      actions.className = 'card-row-actions';
      actions.append(edit, del);

      li.append(main, actions);
      return li;
    });
    els.cardList.replaceChildren(...items);
    highlightCurrentInList();
  }

  function makeButton(text, action, cardId, ariaLabel, className) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = text;
    b.dataset.action = action;
    b.dataset.cardId = cardId;
    b.setAttribute('aria-label', ariaLabel);
    return b;
  }

  /** Update the "current" marker without rebuilding the list (keeps keyboard focus in place). */
  function highlightCurrentInList() {
    const current = visibleCards()[ui.index];
    for (const btn of els.cardList.querySelectorAll('.card-row-main')) {
      if (current && btn.dataset.cardId === current.id) btn.setAttribute('aria-current', 'true');
      else btn.removeAttribute('aria-current');
    }
  }

  /* --------------------------------------------------------------- 5. Actions */

  // Decks
  function selectDeck(id) {
    state.activeDeckId = id;
    ui.query = '';
    els.search.value = '';
    ui.order = [];
    ui.index = 0;
    ui.isShuffled = false;
    ui.seen = new Set();
    ui.flips = 0;
    resetFlip();
    persist();
    render();
  }

  function createDeck(name, color) {
    const deck = { id: uid(), name: name.trim(), color: DECK_COLORS.includes(color) ? color : 'lavender', createdAt: Date.now() };
    state.decks.push(deck);
    state.cardsByDeckId[deck.id] = [];
    selectDeck(deck.id);
    notify(`Deck “${deck.name}” created ✿`);
    return deck;
  }

  function updateDeck(id, name, color) {
    const deck = state.decks.find((d) => d.id === id);
    if (!deck) return;
    deck.name = name.trim();
    if (DECK_COLORS.includes(color)) deck.color = color;
    persist();
    render();
    notify('Deck saved ✓');
  }

  function deleteDeck(id) {
    const i = state.decks.findIndex((d) => d.id === id);
    if (i === -1) return;
    const [removed] = state.decks.splice(i, 1);
    delete state.cardsByDeckId[id];
    const next = state.decks[i] || state.decks[i - 1] || null;
    selectDeck(next ? next.id : null);
    notify(`Deck “${removed.name}” deleted`);
  }

  // Cards
  function createCard(front, back) {
    const deck = activeDeck();
    if (!deck) return;
    const card = { id: uid(), front: front.trim(), back: back.trim(), updatedAt: Date.now() };
    if (!state.cardsByDeckId[deck.id]) state.cardsByDeckId[deck.id] = [];
    state.cardsByDeckId[deck.id].push(card);
    persist();
    syncOrder();
    // Jump to the new card if the current search lets it be seen.
    const pos = visibleCards().findIndex((c) => c.id === card.id);
    if (pos !== -1) { ui.index = pos; resetFlip(); }
    render();
    notify('Card added ✿');
  }

  function updateCard(cardId, front, back) {
    const deck = activeDeck();
    const card = deck && cardsOf(deck.id).find((c) => c.id === cardId);
    if (!card) return;
    card.front = front.trim();
    card.back = back.trim();
    card.updatedAt = Date.now();
    persist();
    // Keep the edited card in view if it is still visible under the current search.
    const pos = visibleCards().findIndex((c) => c.id === cardId);
    if (pos !== -1) ui.index = pos;
    render();
    notify('Card saved ✓');
  }

  function deleteCard(cardId) {
    const deck = activeDeck();
    if (!deck) return;
    const list = cardsOf(deck.id);
    const i = list.findIndex((c) => c.id === cardId);
    if (i === -1) return;
    const wasCurrent = visibleCards()[ui.index]?.id === cardId;
    const visibleBefore = visibleCards().findIndex((c) => c.id === cardId);
    list.splice(i, 1);
    persist();
    syncOrder();
    if (visibleBefore !== -1 && visibleBefore < ui.index) ui.index -= 1; // keep the same card in view
    if (wasCurrent) resetFlip();
    render();
    notify('Card deleted');
  }

  // Study navigation
  function goTo(i) {
    const visible = visibleCards();
    if (!visible.length) return;
    const next = clamp(i, 0, visible.length - 1);
    if (next === ui.index) return; // at a boundary — nothing to do
    const focused = document.activeElement;
    ui.index = next;
    resetFlip();
    renderStudy();
    announce(`Card ${ui.index + 1} of ${visible.length}. Front: ${visible[ui.index].front}`);
    // If Previous/Next just became disabled under the keyboard, don't drop focus to <body>.
    if (focused && focused.disabled) els.flipBtn.focus();
  }

  /** Next button: advance, or loop back to the first card from the last one. */
  function nextOrRestart() {
    const visible = visibleCards();
    if (ui.index >= visible.length - 1 && visible.length > 1) {
      goTo(0);
      notify('Back to the start — round two! ✿');
    } else {
      goTo(ui.index + 1);
    }
  }

  function flip() {
    const card = visibleCards()[ui.index];
    if (!card) return;
    ui.isFlipped = !ui.isFlipped;
    ui.flips += 1;
    applyFlipState();
    renderStats();
    announce(ui.isFlipped ? `Back: ${card.back}` : `Front: ${card.front}`);
  }

  function toggleShuffle() {
    if (ui.isShuffled) {
      ui.isShuffled = false;
      ui.order = []; // syncOrder rebuilds natural order
      notify('Original order restored');
    } else {
      syncOrder();
      // Fisher–Yates on a copy of the ids (the stored cards are untouched).
      const order = ui.order.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      ui.order = order;
      ui.isShuffled = true;
      notify('Cards shuffled ✿');
    }
    ui.index = 0;
    resetFlip();
    render();
  }

  // Import / export
  function exportDeck() {
    const deck = activeDeck();
    if (!deck) return;
    const payload = {
      type: 'flashcards-deck',
      version: 1,
      exportedAt: new Date().toISOString(),
      deck: { name: deck.name, color: deck.color },
      cards: cardsOf(deck.id).map(({ front, back }) => ({ front, back })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${deck.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'deck'}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(`Exported “${deck.name}”`);
  }

  async function importFile(file) {
    try {
      const data = JSON.parse(await file.text());
      const decks = parseImport(data);
      let lastId = null;
      for (const d of decks) {
        // Always mint fresh ids so imported data can never collide with existing decks/cards.
        const deck = { id: uid(), name: uniqueDeckName(d.name), color: d.color, createdAt: Date.now() };
        state.decks.push(deck);
        state.cardsByDeckId[deck.id] = d.cards.map((c) => ({ id: uid(), front: c.front, back: c.back, updatedAt: Date.now() }));
        lastId = deck.id;
      }
      selectDeck(lastId);
      notify(`Imported ${plural(decks.length, 'deck')} ✿`);
    } catch (err) {
      const message = err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message;
      openModal({
        title: 'Import failed',
        description: message,
        submitLabel: 'OK',
        hideCancel: true,
        onSubmit: () => null,
      });
    }
  }

  /* ----------------------------------------------------------------- 6. Modal */

  const modal = { onSubmit: null, opener: null, openerKey: null, fallbackFocus: null, pointerDownOnBackdrop: false };

  /**
   * openModal({ title, description?, fields?, submitLabel, danger?, hideCancel?, onSubmit, fallbackFocus? })
   * fields: [{ name, label, type: 'text' | 'textarea', value?, maxLength?, hint? }]
   * onSubmit(values) → null to close, or { field?, message } to show an error and stay open.
   */
  function openModal(opts) {
    const opener = document.activeElement;
    modal.opener = opener instanceof HTMLElement ? opener : null;
    // Remember how to find the opener again: re-rendering may have replaced the exact node.
    modal.openerKey = modal.opener && modal.opener.dataset.action
      ? { action: modal.opener.dataset.action, cardId: modal.opener.dataset.cardId, deckId: modal.opener.dataset.deckId }
      : null;
    modal.fallbackFocus = opts.fallbackFocus || null;
    modal.onSubmit = opts.onSubmit;

    els.modalTitle.textContent = opts.title;
    els.modalDesc.textContent = opts.description || '';
    els.modalDesc.hidden = !opts.description;
    els.modalError.textContent = '';
    els.modalSubmit.textContent = opts.submitLabel || 'Save';
    els.modalSubmit.className = opts.danger ? 'btn btn-danger' : 'btn btn-primary';
    els.modalCancel.hidden = Boolean(opts.hideCancel);

    const fieldEls = (opts.fields || []).map(buildField);
    els.modalFields.replaceChildren(...fieldEls);

    els.modalRoot.hidden = false;
    els.app.inert = true; // background can't be clicked, tabbed to, or read
    document.body.classList.add('modal-open');
    ui.isModalOpen = true;

    // Text field first; for confirmations, focus Cancel so Enter doesn't destroy anything by accident.
    const firstInput = els.modalFields.querySelector('input, textarea');
    if (firstInput) {
      firstInput.focus();
      if (firstInput.select) firstInput.select();
    } else if (opts.danger && !opts.hideCancel) {
      els.modalCancel.focus();
    } else {
      els.modalSubmit.focus();
    }
  }

  function buildSwatches(f) {
    const fieldset = document.createElement('fieldset');
    fieldset.className = 'field swatches';
    const legend = document.createElement('legend');
    legend.textContent = f.label;
    fieldset.append(legend);
    const row = document.createElement('div');
    row.className = 'swatch-row';
    for (const color of f.options) {
      const id = `modal-field-${f.name}-${color}`;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = f.name;
      input.value = color;
      input.id = id;
      input.className = 'swatch-input';
      input.checked = color === f.value;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.className = 'swatch';
      label.dataset.color = color;
      const text = document.createElement('span');
      text.className = 'visually-hidden';
      text.textContent = color;
      label.append(text);
      row.append(input, label);
    }
    fieldset.append(row);
    return fieldset;
  }

  function buildField(f) {
    if (f.type === 'swatches') return buildSwatches(f);
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const id = `modal-field-${f.name}`;

    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = f.label;

    const input = document.createElement(f.type === 'textarea' ? 'textarea' : 'input');
    if (f.type !== 'textarea') input.type = 'text';
    else input.rows = 3;
    input.id = id;
    input.name = f.name;
    input.value = f.value || '';
    input.required = true;
    if (f.maxLength) input.maxLength = f.maxLength;
    input.setAttribute('aria-describedby', 'modal-error');
    input.autocomplete = 'off';

    wrap.append(label, input);
    if (f.hint) {
      const hint = document.createElement('p');
      hint.className = 'field-hint';
      hint.id = `${id}-hint`;
      hint.textContent = f.hint;
      input.setAttribute('aria-describedby', `${hint.id} modal-error`);
      wrap.append(hint);
    }
    return wrap;
  }

  function closeModal() {
    if (!ui.isModalOpen) return;
    els.modalRoot.hidden = true;
    els.app.inert = false;
    document.body.classList.remove('modal-open');
    ui.isModalOpen = false;
    modal.onSubmit = null;
    els.modalFields.replaceChildren();
    restoreFocus();
  }

  function restoreFocus() {
    const { opener, openerKey, fallbackFocus } = modal;
    let target = null;
    if (opener && opener.isConnected && !opener.disabled && !opener.closest('[hidden]')) {
      target = opener;
    } else if (openerKey) {
      let sel = `[data-action="${CSS.escape(openerKey.action)}"]`;
      if (openerKey.cardId) sel += `[data-card-id="${CSS.escape(openerKey.cardId)}"]`;
      if (openerKey.deckId) sel += `[data-deck-id="${CSS.escape(openerKey.deckId)}"]`;
      target = [...document.querySelectorAll(sel)].find((el) => !el.disabled && !el.closest('[hidden]')) || null;
    }
    if (!target && fallbackFocus) {
      target = [...document.querySelectorAll(fallbackFocus)].find((el) => !el.disabled && !el.closest('[hidden]')) || null;
    }
    (target || els.main).focus();
    modal.opener = modal.openerKey = modal.fallbackFocus = null;
  }

  function getFocusable(container) {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return [...container.querySelectorAll(sel)].filter((el) => !el.hidden && !el.closest('[hidden]'));
  }

  function handleModalKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.tagName === 'TEXTAREA') {
      e.preventDefault();
      els.modalForm.requestSubmit();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getFocusable(els.modalRoot);
    if (!focusable.length) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const outside = !els.modalRoot.contains(active);
    if (e.shiftKey && (active === first || outside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || outside)) {
      e.preventDefault();
      first.focus();
    }
  }

  // Convenience modals
  function openDeckModal(deck = null) {
    // New decks cycle through the palette so the sidebar stays colourful by default.
    const defaultColor = DECK_COLORS[state.decks.length % DECK_COLORS.length];
    openModal({
      title: deck ? 'Edit deck' : 'New deck',
      fields: [
        { name: 'name', label: 'Deck name', value: deck ? deck.name : '', maxLength: MAX_NAME },
        { name: 'color', label: 'Deck color', type: 'swatches', options: DECK_COLORS, value: deck ? deck.color : defaultColor },
      ],
      submitLabel: deck ? 'Save' : 'Create deck',
      fallbackFocus: '[data-action="new-deck"]',
      onSubmit: ({ name, color }) => {
        const error = validateDeckName(name, deck ? deck.id : null);
        if (error) return { field: 'name', message: error };
        if (deck) updateDeck(deck.id, name, color);
        else createDeck(name, color);
        return null;
      },
    });
  }

  function openCardModal(card = null) {
    openModal({
      title: card ? 'Edit card' : 'New card',
      fields: [
        { name: 'front', label: 'Front', type: 'textarea', value: card ? card.front : '', maxLength: MAX_TEXT, hint: 'The question or prompt.' },
        { name: 'back', label: 'Back', type: 'textarea', value: card ? card.back : '', maxLength: MAX_TEXT, hint: 'The answer.' },
      ],
      submitLabel: card ? 'Save card' : 'Add card',
      fallbackFocus: '#flip-btn, [data-action="new-card"]',
      onSubmit: ({ front, back }) => {
        if (!front.trim()) return { field: 'front', message: 'The front of the card can’t be empty.' };
        if (!back.trim()) return { field: 'back', message: 'The back of the card can’t be empty.' };
        if (card) updateCard(card.id, front, back);
        else createCard(front, back);
        return null;
      },
    });
  }

  function confirmDelete({ title, description, onConfirm, fallbackFocus }) {
    openModal({
      title,
      description,
      submitLabel: 'Delete',
      danger: true,
      fallbackFocus,
      onSubmit: () => { onConfirm(); return null; },
    });
  }

  /* ---------------------------------------------------------- 7. Event wiring */

  // One delegated click handler for the whole document — no per-render listeners.
  document.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target || target.disabled) return;
    if (target === els.studyCard && swipe.justSwiped) { swipe.justSwiped = false; return; }
    const { action, cardId, deckId } = target.dataset;
    const deck = activeDeck();

    switch (action) {
      case 'new-deck': openDeckModal(); break;
      case 'select-deck':
        if (deckId !== state.activeDeckId) {
          selectDeck(deckId);
          // The sidebar was re-rendered; put focus back on the (new) button for this deck.
          const btn = els.deckList.querySelector(`[data-deck-id="${CSS.escape(deckId)}"]`);
          if (btn) btn.focus();
        }
        break;
      case 'edit-deck': if (deck) openDeckModal(deck); break;
      case 'delete-deck':
        if (deck) {
          const n = cardsOf(deck.id).length;
          confirmDelete({
            title: `Delete “${deck.name}”?`,
            description: `This removes the deck and its ${plural(n, 'card')}. This can’t be undone.`,
            onConfirm: () => deleteDeck(deck.id),
            fallbackFocus: '.deck-item[aria-current="true"], [data-action="new-deck"]',
          });
        }
        break;
      case 'export-deck': exportDeck(); break;
      case 'import': els.importInput.click(); break;

      case 'new-card': openCardModal(); break;
      case 'edit-card': {
        const card = deck && cardsOf(deck.id).find((c) => c.id === cardId);
        if (card) openCardModal(card);
        break;
      }
      case 'delete-card': {
        const card = deck && cardsOf(deck.id).find((c) => c.id === cardId);
        if (card) {
          confirmDelete({
            title: 'Delete this card?',
            description: `“${truncate(card.front, 80)}” will be removed from ${deck.name}.`,
            onConfirm: () => deleteCard(card.id),
            fallbackFocus: '#flip-btn, [data-action="new-card"]',
          });
        }
        break;
      }
      case 'study-card': {
        const i = Number(target.dataset.index);
        if (Number.isInteger(i)) goTo(i);
        els.studyArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        break;
      }

      case 'flip': flip(); break;
      case 'prev': goTo(ui.index - 1); break;
      case 'next': nextOrRestart(); break;
      case 'shuffle': toggleShuffle(); break;
      case 'clear-search': clearSearch(); els.search.focus(); break;

      case 'modal-cancel': closeModal(); break;
      default: break;
    }
  });

  // Modal form: one submit listener; the current handler lives in modal.onSubmit.
  els.modalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!modal.onSubmit) return;
    const values = {};
    for (const field of els.modalFields.querySelectorAll('input, textarea')) {
      field.removeAttribute('aria-invalid');
      if (field.type === 'radio' && !field.checked) continue;
      values[field.name] = field.value;
    }
    const result = modal.onSubmit(values);
    if (result && result.message) {
      els.modalError.textContent = result.message;
      const bad = result.field && els.modalFields.querySelector(`[name="${result.field}"]`);
      if (bad) { bad.setAttribute('aria-invalid', 'true'); bad.focus(); }
      return;
    }
    closeModal();
  });

  // Backdrop click closes — but only if the press *started* on the backdrop
  // (dragging a text selection out of an input shouldn't close the dialog).
  els.modalRoot.addEventListener('pointerdown', (e) => { modal.pointerDownOnBackdrop = e.target === els.modalRoot; });
  els.modalRoot.addEventListener('click', (e) => {
    if (e.target === els.modalRoot && modal.pointerDownOnBackdrop) closeModal();
  });

  // Keyboard: modal keys when open; otherwise study shortcuts.
  document.addEventListener('keydown', (e) => {
    if (ui.isModalOpen) { handleModalKeydown(e); return; }
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;

    const t = e.target;
    const typing = t.closest && t.closest('input, textarea, select, [contenteditable="true"]');
    if (typing) {
      if (t === els.search && e.key === 'Escape' && els.search.value) { e.preventDefault(); clearSearch(); }
      return;
    }
    if (!activeDeck() || !visibleCards().length) return;

    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); goTo(ui.index - 1); break;
      case 'ArrowRight': e.preventDefault(); goTo(ui.index + 1); break;
      case ' ':
      case 'Spacebar':
        // On a focused button, Space should press that button (native behaviour), not also flip.
        if (t.closest('button, a[href], summary')) return;
        e.preventDefault();
        flip();
        break;
      default: break;
    }
  });

  // Swipe left/right on the study card (touch, pen or mouse drag). A tap still flips.
  const swipe = { x: 0, y: 0, id: null, justSwiped: false };
  const SWIPE_MIN = 50;
  els.studyCard.addEventListener('pointerdown', (e) => {
    swipe.id = e.pointerId;
    swipe.x = e.clientX;
    swipe.y = e.clientY;
    swipe.justSwiped = false;
  });
  els.studyCard.addEventListener('pointerup', (e) => {
    if (e.pointerId !== swipe.id) return;
    swipe.id = null;
    const dx = e.clientX - swipe.x;
    const dy = e.clientY - swipe.y;
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return; // a tap or a vertical scroll
    swipe.justSwiped = true; // swallow the click that follows so the card doesn't also flip
    if (dx < 0) nextOrRestart();
    else goTo(ui.index - 1);
  });
  els.studyCard.addEventListener('pointercancel', () => { swipe.id = null; });

  // Debounced search (300 ms). Filters the view only — stored cards are untouched.
  let searchTimer = null;
  function applySearch() {
    ui.query = els.search.value;
    ui.index = 0;
    resetFlip();
    renderDeckView();
  }
  function clearSearch() {
    clearTimeout(searchTimer);
    els.search.value = '';
    applySearch();
    announce('Search cleared.');
  }
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applySearch, 300);
  });

  els.importInput.addEventListener('change', async () => {
    const file = els.importInput.files && els.importInput.files[0];
    els.importInput.value = ''; // allow re-importing the same file
    if (file) await importFile(file);
  });

  // Another tab changed our data: reload instead of later overwriting it with stale state.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    const fresh = loadState();
    state.decks = fresh.decks;
    state.cardsByDeckId = fresh.cardsByDeckId;
    if (!state.decks.some((d) => d.id === state.activeDeckId)) {
      state.activeDeckId = fresh.activeDeckId;
      ui.order = [];
      ui.index = 0;
    }
    render();
    announce('Decks updated from another tab.');
  });

  /* ------------------------------------------------------------------ Start */

  function seedSampleDeck() {
    const deck = { id: uid(), name: 'Sample: Web Basics', color: 'lavender', createdAt: Date.now() };
    const pairs = [
      ['What does HTML stand for?', 'HyperText Markup Language'],
      ['Which CSS property creates a 3D flip?', 'transform: rotateY(180deg) — with perspective on the parent and backface-visibility: hidden on each face.'],
      ['What does localStorage store?', 'Strings only — objects must be JSON.stringify’d and JSON.parse’d.'],
      ['What is event delegation?', 'One listener on a parent handles events from its children via event.target.closest().'],
      ['What does aria-live="polite" do?', 'Screen readers announce changes to that region when the user is idle.'],
    ];
    state.decks.push(deck);
    state.cardsByDeckId[deck.id] = pairs.map(([front, back]) => ({ id: uid(), front, back, updatedAt: Date.now() }));
    state.activeDeckId = deck.id;
    persist();
  }

  if (isFirstVisit && state.decks.length === 0) seedSampleDeck();
  render();
})();
