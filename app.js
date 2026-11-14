/*
 * app.js — Flashcards Study App (vanilla JS, no build step).
 *
 * Structure:
 *   1. State + element lookups
 *   2. Helpers (ids, lookups, validation, announcements, toasts)
 *   3. View model (selected decks → ordered → searched → mastery-filtered cards)
 *   4. Rendering (small functions; all user text goes through textContent, never innerHTML)
 *   5. Actions (deck CRUD, card CRUD, mastery, study navigation, filters, tabs, import/export)
 *   6. Modal (focus trap, Esc, return focus)
 *   7. Event wiring — every listener is bound exactly once; clicks use one delegated handler
 */
(function () {
  'use strict';

  const {
    loadState, saveState, hasSavedState, parseImport,
    STORAGE_KEY, MAX_NAME, MAX_TEXT, MAX_MASTERY, DECK_COLORS,
  } = window.FlashStorage;

  const PAGE_SIZE = 12;
  const COLOR_HEX = { pink: '#ffb3c6', lavender: '#c8b6ff', mint: '#a0e7e5', peach: '#ffdac1', yellow: '#fce38a' };

  /* ---------------------------------------------------------------- 1. State */

  const isFirstVisit = !hasSavedState();
  // Persisted: { decks, cardsByDeckId, activeDeckId, selectedDeckIds, view }
  const state = loadState();

  // Transient UI state — never persisted, never mixed into `state`.
  const ui = {
    query: '',            // current (debounced) search text
    order: [],            // card ids in study order (shuffle reorders this, never the data)
    index: 0,             // position within the *visible* cards
    isFlipped: false,
    isShuffled: false,
    hideMastered: false,
    shown: PAGE_SIZE,     // how many cards the "All cards" grid shows before "Load more"
    isModalOpen: false,
    filterOpen: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const els = {
    app: $('#app'),
    main: $('#main'),
    deckList: $('#deck-list'),
    deckEmpty: $('#deck-empty'),
    noDeck: $('#no-deck'),
    deckView: $('#deck-view'),
    deckBadge: $('#deck-badge'),
    deckTitle: $('#deck-title'),
    deckMeta: $('#deck-meta'),
    deckActions: $('#deck-actions'),
    search: $('#search-input'),
    searchCount: $('#search-count'),
    deckFilter: $('#deck-filter'),
    deckFilterBtn: $('#deck-filter-btn'),
    deckFilterLabel: $('#deck-filter-label'),
    deckFilterPanel: $('#deck-filter-panel'),
    deckFilterList: $('#deck-filter-list'),
    hideMastered: $('#hide-mastered'),
    shuffleBtn: $('#shuffle-btn'),
    tabStudy: $('#tab-study'),
    tabAll: $('#tab-all'),
    tabAllCount: $('#tab-all-count'),
    panelStudy: $('#panel-study'),
    panelAll: $('#panel-all'),
    studyEmpty: $('#study-empty'),
    studyArea: $('#study-area'),
    position: $('#study-position'),
    progressFill: $('#progress-fill'),
    studyCard: $('#study-card'),
    cardInner: $('#card-inner'),
    frontFace: $('#card-front-face'),
    backFace: $('#card-back-face'),
    frontText: $('#card-front-text'),
    backText: $('#card-back-text'),
    deckFront: $('#card-deck-front'),
    deckBack: $('#card-deck-back'),
    studyMastery: $('#study-mastery'),
    resetCurrentBtn: $('#reset-current-btn'),
    knowBtn: $('#know-btn'),
    learningBtn: $('#learning-btn'),
    prevBtn: $('#prev-btn'),
    nextBtn: $('#next-btn'),
    flipBtn: $('#flip-btn'),
    editCurrentBtn: $('#edit-current-btn'),
    deleteCurrentBtn: $('#delete-current-btn'),
    statsBar: $('#stats-bar'),
    segMastered: $('#seg-mastered'),
    segProgress: $('#seg-progress'),
    segNew: $('#seg-new'),
    statTotal: $('#stat-total'),
    statMastered: $('#stat-mastered'),
    statProgress: $('#stat-progress'),
    statNew: $('#stat-new'),
    allEmpty: $('#all-empty'),
    cardGrid: $('#card-grid'),
    gridCount: $('#grid-count'),
    loadMoreBtn: $('#load-more-btn'),
    importInput: $('#import-input'),
    announcer: $('#announcer'),
    toastRegion: $('#toast-region'),
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
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
  const deckById = (id) => state.decks.find((d) => d.id === id) || null;
  const cardsOf = (deckId) => state.cardsByDeckId[deckId] || [];
  const selectedDecks = () => state.selectedDeckIds.map(deckById).filter(Boolean);
  /** The one selected deck, or null when 0 or several decks are selected. */
  const singleDeck = () => (state.selectedDeckIds.length === 1 ? deckById(state.selectedDeckIds[0]) : null);

  /** Find a card anywhere, with the deck it belongs to. */
  function findCard(cardId) {
    for (const deck of state.decks) {
      const card = cardsOf(deck.id).find((c) => c.id === cardId);
      if (card) return { card, deck };
    }
    return null;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function announce(message) {
    // Clear first so repeating the same message is still announced.
    els.announcer.textContent = '';
    requestAnimationFrame(() => { els.announcer.textContent = message; });
  }

  /** Announce to screen readers AND show a little visual toast. */
  function notify(message) {
    announce(message);
    const toast = el('div', 'toast', message);
    els.toastRegion.append(toast);
    while (els.toastRegion.children.length > 3) els.toastRegion.firstElementChild.remove();
    setTimeout(() => {
      toast.classList.add('toast--leaving');
      setTimeout(() => toast.remove(), 300);
    }, 2200);
  }

  function persist() {
    if (!saveState(state)) notify('Couldn’t save — browser storage may be full or turned off.');
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

  /** If the focused element disappeared or got disabled, move focus somewhere sensible. */
  function rescueFocus(...candidates) {
    const a = document.activeElement;
    const lost = !a || a === document.body || !a.isConnected || a.disabled || a.closest('[hidden]');
    if (!lost) return;
    const target = candidates.find((c) => c && c.isConnected && !c.disabled && !c.closest('[hidden]'));
    (target || els.main).focus();
  }

  /* ----------------------------------------------------------- 3. View model */

  /** Every card in the selected decks, as { card, deck }. */
  function scopeEntries() {
    return selectedDecks().flatMap((deck) => cardsOf(deck.id).map((card) => ({ card, deck })));
  }

  /** Keep ui.order in step with the selected decks without losing a shuffled order. */
  function syncOrder() {
    const ids = scopeEntries().map((e) => e.card.id);
    const exists = new Set(ids);
    const kept = ui.order.filter((id) => exists.has(id));
    const keptSet = new Set(kept);
    ui.order = kept.concat(ids.filter((id) => !keptSet.has(id)));
  }

  const matchesQuery = (card, q) => !q || card.front.toLowerCase().includes(q) || card.back.toLowerCase().includes(q);

  /** Cards to show/study: study order → search → hide-mastered. Never mutates stored data. */
  function visibleCards() {
    const byId = new Map(scopeEntries().map((e) => [e.card.id, e]));
    const q = ui.query.trim().toLowerCase();
    return ui.order
      .map((id) => byId.get(id))
      .filter((e) => e && matchesQuery(e.card, q) && !(ui.hideMastered && e.card.mastery >= MAX_MASTERY));
  }

  function masteryCounts(entries) {
    const counts = { total: entries.length, mastered: 0, progress: 0, fresh: 0 };
    for (const { card } of entries) {
      if (card.mastery >= MAX_MASTERY) counts.mastered += 1;
      else if (card.mastery > 0) counts.progress += 1;
      else counts.fresh += 1;
    }
    return counts;
  }

  /** Why is the visible list empty? Returns the empty-state content to show, or null. */
  function emptyReason(visible) {
    if (visible.length) return null;
    if (!selectedDecks().length) {
      return { face: '(・・ ) ?', title: 'No decks selected', text: 'Pick at least one deck to study.', action: 'toggle-deck-filter', label: 'Choose decks' };
    }
    const scope = scopeEntries();
    if (!scope.length) {
      return { face: '(◕ᴗ◕✿)', title: 'No cards yet', text: 'Add a card with a question and an answer to start studying.', action: 'new-card', label: '+ Add a card', primary: true };
    }
    const q = ui.query.trim().toLowerCase();
    const matching = scope.filter((e) => matchesQuery(e.card, q));
    if (!matching.length) {
      return { face: '(・・ ) ?', title: 'No cards found', text: `Nothing matches “${ui.query.trim()}”.`, action: 'clear-search', label: 'Clear search' };
    }
    return { face: '(ﾉ◕ヮ◕)ﾉ*:･ﾟ✧', title: 'Everything here is mastered!', text: 'Turn off “Hide mastered” to review them again.', action: 'show-mastered', label: 'Show mastered cards' };
  }

  /* ------------------------------------------------------------- 4. Rendering */

  function render() {
    syncOrder();
    renderDecks();
    renderMain();
  }

  function renderDecks() {
    const selected = new Set(state.selectedDeckIds);
    const items = state.decks.map((deck) => {
      const li = el('li');
      const btn = el('button', 'deck-item');
      btn.type = 'button';
      btn.dataset.action = 'select-deck';
      btn.dataset.deckId = deck.id;
      btn.dataset.color = deck.color;
      if (selected.has(deck.id)) btn.setAttribute('aria-current', 'true');

      const dot = el('span', 'deck-dot');
      dot.setAttribute('aria-hidden', 'true');
      const name = el('span', 'deck-name', deck.name);
      const n = cardsOf(deck.id).length;
      const count = el('span', 'deck-count', String(n));
      count.append(el('span', 'visually-hidden', n === 1 ? ' card' : ' cards'));

      btn.append(dot, name, count);
      li.append(btn);
      return li;
    });
    els.deckList.replaceChildren(...items);
    els.deckEmpty.hidden = state.decks.length > 0;
  }

  function renderMain() {
    const hasDecks = state.decks.length > 0;
    els.noDeck.hidden = hasDecks;
    els.deckView.hidden = !hasDecks;
    if (!hasDecks) return;

    const visible = visibleCards();
    renderHeader();
    renderToolbar(visible);
    renderDeckFilter();
    renderTabs(visible);
    renderStudy(visible);
    renderStats();
    renderGrid(visible);
  }

  function renderHeader() {
    const decks = selectedDecks();
    const single = singleDeck();
    const total = scopeEntries().length;
    els.deckActions.hidden = !single;

    if (single) {
      els.deckView.dataset.color = single.color;
      els.deckBadge.style.background = '';
      els.deckTitle.textContent = single.name;
      els.deckMeta.textContent = `${plural(total, 'card')} · created ${new Date(single.createdAt).toLocaleDateString()}`;
    } else {
      delete els.deckView.dataset.color;
      // A pastel pie of the mixed decks' colours.
      const colors = decks.length ? decks.map((d) => COLOR_HEX[d.color]) : ['#efe1f0'];
      const step = 100 / colors.length;
      els.deckBadge.style.background = `conic-gradient(${colors.map((c, i) => `${c} ${i * step}% ${(i + 1) * step}%`).join(', ')})`;
      els.deckTitle.textContent = decks.length ? 'Mixed study' : 'No decks selected';
      els.deckMeta.textContent = decks.length
        ? `${plural(decks.length, 'deck')} · ${plural(total, 'card')} · ${truncate(decks.map((d) => d.name).join(', '), 60)}`
        : 'Use the Decks filter or pick a deck in the sidebar.';
    }
  }

  function renderToolbar(visible) {
    const scopeCount = scopeEntries().length;
    const q = ui.query.trim();
    els.search.disabled = scopeCount === 0;
    els.searchCount.textContent = q ? `${visible.length} of ${plural(scopeCount, 'card')} match` : '';
    els.hideMastered.checked = ui.hideMastered;
    els.shuffleBtn.disabled = visible.length < 2;
    els.shuffleBtn.setAttribute('aria-pressed', String(ui.isShuffled));
    els.shuffleBtn.textContent = ui.isShuffled ? 'Shuffled ✓' : 'Shuffle';
  }

  function renderDeckFilter() {
    const n = state.selectedDeckIds.length;
    const total = state.decks.length;
    els.deckFilterLabel.textContent =
      n === 0 ? 'Decks: none' :
      n === total && total > 1 ? 'Decks: all' :
      n === 1 ? `Deck: ${truncate(singleDeck().name, 18)}` :
      `Decks: ${n} selected`;
    els.deckFilterBtn.setAttribute('aria-expanded', String(ui.filterOpen));

    // Don't rebuild the list under the user's keyboard focus while the panel is open.
    if (ui.filterOpen) return;
    const selected = new Set(state.selectedDeckIds);
    const items = state.decks.map((deck) => {
      const li = el('li');
      const label = el('label', 'filter-option');
      label.dataset.color = deck.color;
      const input = el('input');
      input.type = 'checkbox';
      input.value = deck.id;
      input.checked = selected.has(deck.id);
      const dot = el('span', 'deck-dot');
      dot.setAttribute('aria-hidden', 'true');
      const name = el('span', 'filter-name', deck.name);
      const count = cardsOf(deck.id).length;
      const badge = el('span', 'deck-count', String(count));
      badge.append(el('span', 'visually-hidden', count === 1 ? ' card' : ' cards'));
      label.append(input, dot, name, badge);
      li.append(label);
      return li;
    });
    els.deckFilterList.replaceChildren(...items);
  }

  function renderTabs(visible) {
    const isStudy = state.view === 'study';
    els.tabStudy.setAttribute('aria-selected', String(isStudy));
    els.tabAll.setAttribute('aria-selected', String(!isStudy));
    els.tabStudy.tabIndex = isStudy ? 0 : -1;
    els.tabAll.tabIndex = isStudy ? -1 : 0;
    els.panelStudy.hidden = !isStudy;
    els.panelAll.hidden = isStudy;
    els.tabAllCount.textContent = String(visible.length);
  }

  function fillEmpty(container, reason) {
    const face = el('span', 'kaomoji', reason.face);
    face.setAttribute('aria-hidden', 'true');
    const title = el('p');
    title.append(el('strong', '', reason.title));
    const text = el('p', 'muted', reason.text);
    const btn = el('button', reason.primary ? 'btn btn-primary' : 'btn btn-soft', reason.label);
    btn.type = 'button';
    btn.dataset.action = reason.action;
    container.replaceChildren(face, title, text, btn);
  }

  /** Five little dots + "3/5". The whole thing is one image to screen readers. */
  function masteryMeter(level, { small = false } = {}) {
    const wrap = el('span', `meter${small ? ' meter--sm' : ''}${level >= MAX_MASTERY ? ' is-mastered' : ''}`);
    wrap.setAttribute('role', 'img');
    wrap.setAttribute('aria-label', level >= MAX_MASTERY ? `Mastered, ${level} of ${MAX_MASTERY}` : `Mastery ${level} of ${MAX_MASTERY}`);
    const dots = el('span', 'meter-dots');
    for (let i = 0; i < MAX_MASTERY; i++) dots.append(el('span', i < level ? 'meter-dot is-on' : 'meter-dot'));
    const text = el('span', 'meter-text', level >= MAX_MASTERY ? 'Mastered ✿' : `${level}/${MAX_MASTERY}`);
    wrap.append(dots, text);
    return wrap;
  }

  function renderStudy(visible = visibleCards()) {
    const reason = emptyReason(visible);
    els.studyEmpty.hidden = !reason;
    els.studyArea.hidden = Boolean(reason);
    if (reason) { fillEmpty(els.studyEmpty, reason); return; }

    ui.index = clamp(ui.index, 0, visible.length - 1);
    const { card, deck } = visible[ui.index];
    const mixed = state.selectedDeckIds.length > 1;

    els.studyCard.dataset.color = deck.color;
    els.frontText.textContent = card.front || '(blank)';
    els.backText.textContent = card.back || '(blank)';
    for (const tag of [els.deckFront, els.deckBack]) {
      tag.textContent = deck.name;
      tag.hidden = !mixed;
    }

    els.position.textContent = `Card ${ui.index + 1} of ${visible.length}`;
    els.progressFill.style.width = `${((ui.index + 1) / visible.length) * 100}%`;

    // Prev is disabled on the first card. On the last card, Next becomes "Start over".
    const isLast = ui.index === visible.length - 1;
    els.prevBtn.disabled = ui.index === 0;
    els.nextBtn.disabled = visible.length < 2;
    els.nextBtn.textContent = isLast && visible.length > 1 ? 'Start over ↺' : 'Next →';
    els.nextBtn.classList.toggle('is-restart', isLast && visible.length > 1);

    els.studyMastery.replaceChildren(masteryMeter(card.mastery));
    els.resetCurrentBtn.disabled = card.mastery === 0;

    applyFlipState();

    for (const b of [els.editCurrentBtn, els.deleteCurrentBtn, els.resetCurrentBtn, els.knowBtn, els.learningBtn]) {
      b.dataset.cardId = card.id;
    }
  }

  function applyFlipState() {
    els.cardInner.classList.toggle('is-flipped', ui.isFlipped);
    els.flipBtn.setAttribute('aria-pressed', String(ui.isFlipped));
    els.flipBtn.textContent = ui.isFlipped ? 'Show question' : 'Reveal answer';
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

  function renderStats() {
    const c = masteryCounts(scopeEntries());
    els.statTotal.textContent = String(c.total);
    els.statMastered.textContent = String(c.mastered);
    els.statProgress.textContent = String(c.progress);
    els.statNew.textContent = String(c.fresh);
    const pct = (n) => (c.total ? `${(n / c.total) * 100}%` : '0%');
    els.segMastered.style.width = pct(c.mastered);
    els.segProgress.style.width = pct(c.progress);
    els.segNew.style.width = c.total ? pct(c.fresh) : '100%';
  }

  function renderGrid(visible = visibleCards()) {
    const reason = emptyReason(visible);
    els.allEmpty.hidden = !reason;
    if (reason) fillEmpty(els.allEmpty, reason);

    const shown = visible.slice(0, ui.shown);
    const items = shown.map(({ card, deck }) => {
      const li = el('li', 'grid-card');
      li.dataset.color = deck.color;
      li.dataset.cardId = card.id;

      const top = el('div', 'grid-card-top');
      top.append(el('span', 'deck-chip', deck.name), masteryMeter(card.mastery, { small: true }));

      const q = el('p', 'grid-q', card.front || '(blank)');
      const a = el('p', 'grid-a', card.back || '(blank)');

      const label = truncate(card.front || 'blank card', 40);
      const actions = el('div', 'grid-card-actions');
      actions.append(
        makeButton('Study', 'study-card', card.id, `Study card: ${label}`, 'btn btn-primary btn-sm'),
        makeButton('Edit', 'edit-card', card.id, `Edit card: ${label}`, 'btn btn-soft btn-sm'),
        makeButton('Reset', 'reset-progress', card.id, `Reset progress: ${label}`, 'btn btn-soft btn-sm', card.mastery === 0),
        makeButton('Delete', 'delete-card', card.id, `Delete card: ${label}`, 'btn btn-danger-soft btn-sm'),
      );

      li.append(top, q, a, actions);
      return li;
    });
    els.cardGrid.replaceChildren(...items);
    els.cardGrid.hidden = !shown.length;

    const remaining = visible.length - shown.length;
    els.gridCount.textContent = visible.length ? `Showing ${shown.length} of ${plural(visible.length, 'card')}` : '';
    els.loadMoreBtn.hidden = remaining <= 0;
    els.loadMoreBtn.textContent = `Load ${Math.min(PAGE_SIZE, remaining)} more`;
  }

  function makeButton(text, action, cardId, ariaLabel, className, disabled = false) {
    const b = el('button', className, text);
    b.type = 'button';
    b.dataset.action = action;
    b.dataset.cardId = cardId;
    b.setAttribute('aria-label', ariaLabel);
    b.disabled = disabled;
    return b;
  }

  /* --------------------------------------------------------------- 5. Actions */

  /** Reset per-view state whenever what we're looking at changes. */
  function resetView() {
    ui.order = [];
    ui.index = 0;
    ui.isShuffled = false;
    ui.shown = PAGE_SIZE;
    resetFlip();
  }

  // Deck selection & filters
  function setSelection(ids) {
    state.selectedDeckIds = ids.filter((id) => deckById(id));
    resetView();
    persist();
    render();
  }

  function toggleFilter(open = !ui.filterOpen, { returnFocus = false } = {}) {
    if (open === ui.filterOpen) return;
    if (open) {
      ui.filterOpen = false;
      renderDeckFilter(); // rebuild with fresh counts before opening
      ui.filterOpen = true;
      els.deckFilterPanel.hidden = false;
      els.deckFilterBtn.setAttribute('aria-expanded', 'true');
      const first = els.deckFilterList.querySelector('input');
      if (first) first.focus();
    } else {
      ui.filterOpen = false;
      els.deckFilterPanel.hidden = true;
      els.deckFilterBtn.setAttribute('aria-expanded', 'false');
      renderDeckFilter();
      if (returnFocus) els.deckFilterBtn.focus();
    }
  }

  function setHideMastered(on) {
    ui.hideMastered = on;
    ui.index = 0;
    ui.shown = PAGE_SIZE;
    resetFlip();
    renderMain();
    announce(on ? 'Mastered cards hidden.' : 'Showing all cards.');
  }

  // Tabs
  function setView(view, { focusTab = false } = {}) {
    if (view !== 'study' && view !== 'all') return;
    state.view = view;
    persist();
    renderMain();
    if (focusTab) (view === 'study' ? els.tabStudy : els.tabAll).focus();
  }

  // Decks
  function createDeck(name, color) {
    const deck = { id: uid(), name: name.trim(), color: DECK_COLORS.includes(color) ? color : 'lavender', createdAt: Date.now() };
    state.decks.push(deck);
    state.cardsByDeckId[deck.id] = [];
    setSelection([deck.id]);
    notify(`Deck “${deck.name}” created ✿`);
  }

  function updateDeck(id, name, color) {
    const deck = deckById(id);
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
    let ids = state.selectedDeckIds.filter((x) => x !== id);
    if (!ids.length) {
      const next = state.decks[i] || state.decks[i - 1];
      ids = next ? [next.id] : [];
    }
    setSelection(ids);
    notify(`Deck “${removed.name}” deleted`);
  }

  // Cards
  function createCard(front, back, deckId) {
    const deck = deckById(deckId);
    if (!deck) return;
    const card = { id: uid(), front: front.trim(), back: back.trim(), mastery: 0, updatedAt: Date.now() };
    if (!state.cardsByDeckId[deck.id]) state.cardsByDeckId[deck.id] = [];
    state.cardsByDeckId[deck.id].push(card);
    persist();
    syncOrder();
    // Jump to the new card if the current filters let it be seen.
    const pos = visibleCards().findIndex((e) => e.card.id === card.id);
    if (pos !== -1 && state.view === 'study') { ui.index = pos; resetFlip(); }
    render();
    notify(state.selectedDeckIds.includes(deck.id) ? 'Card created ✿' : `Card added to “${deck.name}” ✿`);
  }

  function updateCard(cardId, front, back, deckId) {
    const found = findCard(cardId);
    if (!found) return;
    const { card, deck } = found;
    card.front = front.trim();
    card.back = back.trim();
    card.updatedAt = Date.now();
    if (deckId && deckId !== deck.id && deckById(deckId)) {
      // Move the card to its new deck (category).
      state.cardsByDeckId[deck.id] = cardsOf(deck.id).filter((c) => c.id !== cardId);
      if (!state.cardsByDeckId[deckId]) state.cardsByDeckId[deckId] = [];
      state.cardsByDeckId[deckId].push(card);
    }
    persist();
    syncOrder();
    const pos = visibleCards().findIndex((e) => e.card.id === cardId);
    if (pos !== -1 && state.view === 'study') ui.index = pos;
    render();
    notify('Card updated ✓');
  }

  function deleteCard(cardId) {
    const found = findCard(cardId);
    if (!found) return;
    const visibleBefore = visibleCards();
    const posBefore = visibleBefore.findIndex((e) => e.card.id === cardId);
    const wasCurrent = posBefore === ui.index;
    state.cardsByDeckId[found.deck.id] = cardsOf(found.deck.id).filter((c) => c.id !== cardId);
    persist();
    syncOrder();
    if (posBefore !== -1 && posBefore < ui.index) ui.index -= 1; // keep the same card in view
    if (wasCurrent) resetFlip();
    render();
    notify('Card deleted');
  }

  // Mastery
  /**
   * "I know this" (+1) or "Still learning" (−1), then move on to the next card.
   * If "Hide mastered" makes the card disappear, the same index already points at the next one.
   */
  function review(delta) {
    const visible = visibleCards();
    const entry = visible[ui.index];
    if (!entry) return;
    const { card } = entry;
    const before = card.mastery;
    card.mastery = clamp(before + delta, 0, MAX_MASTERY);
    card.updatedAt = Date.now();
    persist();

    const after = visibleCards();
    const stillVisible = after.some((e) => e.card.id === card.id);
    const wasLast = ui.index >= visible.length - 1;
    if (stillVisible && !wasLast) ui.index += 1;
    resetFlip();
    renderMain();

    let msg;
    if (delta > 0) {
      msg = card.mastery >= MAX_MASTERY ? (before >= MAX_MASTERY ? 'Still mastered ✿' : 'Mastered! ✿ 5/5') : `Nice! ${card.mastery}/5`;
    } else {
      msg = `Keep practicing — ${card.mastery}/5`;
    }
    if (wasLast && stillVisible && visible.length > 1) msg += ' · that was the last card';
    notify(msg);
    rescueFocus(els.knowBtn, els.studyEmpty.querySelector('button'));
  }

  function resetProgress(cardId) {
    const found = findCard(cardId);
    if (!found || found.card.mastery === 0) return;
    found.card.mastery = 0;
    found.card.updatedAt = Date.now();
    persist();
    renderMain();
    notify('Progress reset — fresh start ✿');
    // The Reset button just disabled itself; keep keyboard users nearby.
    if (state.view === 'study') rescueFocus(els.knowBtn, els.flipBtn);
    else rescueFocus(els.cardGrid.querySelector(`[data-action="edit-card"][data-card-id="${CSS.escape(cardId)}"]`));
  }

  // Study navigation
  function goTo(i) {
    const visible = visibleCards();
    if (!visible.length) return;
    const next = clamp(i, 0, visible.length - 1);
    if (next === ui.index) return; // at a boundary — nothing to do
    ui.index = next;
    resetFlip();
    renderStudy(visible);
    announce(`Card ${ui.index + 1} of ${visible.length}. Question: ${visible[ui.index].card.front}`);
    rescueFocus(els.flipBtn); // e.g. Prev just became disabled under the keyboard
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
    const entry = visibleCards()[ui.index];
    if (!entry) return;
    ui.isFlipped = !ui.isFlipped;
    applyFlipState();
    announce(ui.isFlipped ? `Answer: ${entry.card.back}` : `Question: ${entry.card.front}`);
  }

  function toggleShuffle() {
    if (ui.isShuffled) {
      ui.isShuffled = false;
      ui.order = []; // syncOrder rebuilds the natural order
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

  function studyCard(cardId) {
    syncOrder();
    const pos = visibleCards().findIndex((e) => e.card.id === cardId);
    if (pos === -1) return;
    ui.index = pos;
    resetFlip();
    setView('study');
    els.flipBtn.focus();
    els.studyArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function loadMore() {
    const firstNew = ui.shown;
    ui.shown += PAGE_SIZE;
    renderGrid();
    const btn = els.cardGrid.children[firstNew]?.querySelector('[data-action="study-card"]');
    if (btn) btn.focus();
    announce(`Showing ${Math.min(ui.shown, visibleCards().length)} cards.`);
  }

  // Import / export
  function exportDeck() {
    const deck = singleDeck();
    if (!deck) return;
    const payload = {
      type: 'flashcards-deck',
      version: 2,
      exportedAt: new Date().toISOString(),
      deck: { name: deck.name, color: deck.color },
      cards: cardsOf(deck.id).map(({ front, back, mastery }) => ({ front, back, mastery })),
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
      const ids = [];
      for (const d of decks) {
        // Always mint fresh ids so imported data can never collide with existing decks/cards.
        const deck = { id: uid(), name: uniqueDeckName(d.name), color: d.color, createdAt: Date.now() };
        state.decks.push(deck);
        state.cardsByDeckId[deck.id] = d.cards.map((c) => ({ id: uid(), front: c.front, back: c.back, mastery: c.mastery, updatedAt: Date.now() }));
        ids.push(deck.id);
      }
      setSelection(ids);
      notify(`Imported ${plural(decks.length, 'deck')} ✿`);
    } catch (err) {
      const message = err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message;
      openModal({ title: 'Import failed', description: message, submitLabel: 'OK', hideCancel: true, onSubmit: () => null });
    }
  }

  /* ----------------------------------------------------------------- 6. Modal */

  const modal = { onSubmit: null, opener: null, openerKey: null, fallbackFocus: null, pointerDownOnBackdrop: false };

  /**
   * openModal({ title, description?, fields?, submitLabel, danger?, hideCancel?, onSubmit, fallbackFocus? })
   * fields: [{ name, label, type: 'text' | 'textarea' | 'select' | 'swatches', value?, options?, maxLength?, hint? }]
   * onSubmit(values) → null to close, or { field?, message } to show an error and stay open.
   */
  function openModal(opts) {
    if (ui.filterOpen) toggleFilter(false);
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
    els.modalFields.replaceChildren(...(opts.fields || []).map(buildField));

    els.modalRoot.hidden = false;
    els.app.inert = true; // background can't be clicked, tabbed to, or read
    document.body.classList.add('modal-open');
    ui.isModalOpen = true;

    // Text field first; for confirmations, focus Cancel so Enter doesn't destroy anything by accident.
    const firstInput = els.modalFields.querySelector('input:not([type="radio"]), textarea, select');
    if (firstInput) {
      firstInput.focus();
      if (firstInput.select && firstInput.tagName !== 'SELECT') firstInput.select();
    } else if (opts.danger && !opts.hideCancel) {
      els.modalCancel.focus();
    } else {
      els.modalSubmit.focus();
    }
  }

  function buildSwatches(f) {
    const fieldset = el('fieldset', 'field swatches');
    fieldset.append(el('legend', '', f.label));
    const row = el('div', 'swatch-row');
    for (const color of f.options) {
      const id = `modal-field-${f.name}-${color}`;
      const input = el('input', 'swatch-input');
      input.type = 'radio';
      input.name = f.name;
      input.value = color;
      input.id = id;
      input.checked = color === f.value;
      const label = el('label', 'swatch');
      label.htmlFor = id;
      label.dataset.color = color;
      label.append(el('span', 'visually-hidden', color));
      row.append(input, label);
    }
    fieldset.append(row);
    return fieldset;
  }

  function buildField(f) {
    if (f.type === 'swatches') return buildSwatches(f);
    const wrap = el('div', 'field');
    const id = `modal-field-${f.name}`;
    const label = el('label', '', f.label);
    label.htmlFor = id;

    let input;
    if (f.type === 'select') {
      input = el('select');
      for (const opt of f.options) {
        const o = el('option', '', opt.label);
        o.value = opt.value;
        o.selected = opt.value === f.value;
        input.append(o);
      }
    } else {
      input = el(f.type === 'textarea' ? 'textarea' : 'input');
      if (f.type === 'textarea') input.rows = 3;
      else input.type = 'text';
      input.value = f.value || '';
      input.autocomplete = 'off';
      if (f.maxLength) input.maxLength = f.maxLength;
    }
    input.id = id;
    input.name = f.name;
    input.required = true;
    input.setAttribute('aria-describedby', 'modal-error');

    wrap.append(label, input);
    if (f.hint) {
      const hint = el('p', 'field-hint', f.hint);
      hint.id = `${id}-hint`;
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
    const usable = (node) => node && node.isConnected && !node.disabled && !node.closest('[hidden]');
    let target = usable(opener) ? opener : null;
    if (!target && openerKey) {
      let sel = `[data-action="${CSS.escape(openerKey.action)}"]`;
      if (openerKey.cardId) sel += `[data-card-id="${CSS.escape(openerKey.cardId)}"]`;
      if (openerKey.deckId) sel += `[data-deck-id="${CSS.escape(openerKey.deckId)}"]`;
      target = [...document.querySelectorAll(sel)].find(usable) || null;
    }
    if (!target && fallbackFocus) target = [...document.querySelectorAll(fallbackFocus)].find(usable) || null;
    (target || els.main).focus();
    modal.opener = modal.openerKey = modal.fallbackFocus = null;
  }

  function getFocusable(container) {
    const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return [...container.querySelectorAll(sel)].filter((node) => !node.closest('[hidden]'));
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

  function openCardModal(card = null, currentDeckId = null) {
    const defaultDeck = currentDeckId || state.selectedDeckIds[0] || (state.decks[0] && state.decks[0].id);
    openModal({
      title: card ? 'Edit card' : 'New card',
      fields: [
        { name: 'front', label: 'Question', type: 'textarea', value: card ? card.front : '', maxLength: MAX_TEXT, hint: 'Shown on the front of the card.' },
        { name: 'back', label: 'Answer', type: 'textarea', value: card ? card.back : '', maxLength: MAX_TEXT, hint: 'Revealed when you flip it.' },
        { name: 'deck', label: 'Deck (category)', type: 'select', value: defaultDeck, options: state.decks.map((d) => ({ value: d.id, label: d.name })) },
      ],
      submitLabel: card ? 'Save card' : 'Create card',
      fallbackFocus: '#flip-btn, [data-action="new-card"]',
      onSubmit: ({ front, back, deck }) => {
        if (!front.trim() && !back.trim()) return { field: 'front', message: 'Fill in a question and an answer.' };
        if (!front.trim()) return { field: 'front', message: 'Add a question for the front of the card.' };
        if (!back.trim()) return { field: 'back', message: 'Add an answer for the back of the card.' };
        if (!deckById(deck)) return { field: 'deck', message: 'Pick a deck for this card.' };
        if (card) updateCard(card.id, front, back, deck);
        else createCard(front, back, deck);
        return null;
      },
    });
  }

  function confirmDelete({ title, description, onConfirm, fallbackFocus }) {
    openModal({ title, description, submitLabel: 'Delete', danger: true, fallbackFocus, onSubmit: () => { onConfirm(); return null; } });
  }

  /* ---------------------------------------------------------- 7. Event wiring */

  // Swipe state (declared before the click handler that reads it).
  const swipe = { x: 0, y: 0, id: null, justSwiped: false };
  const SWIPE_MIN = 50;

  // One delegated click handler for the whole document — no per-render listeners.
  document.addEventListener('click', (e) => {
    // Clicking anywhere outside the deck filter closes it.
    if (ui.filterOpen && !els.deckFilter.contains(e.target)) toggleFilter(false);

    const target = e.target.closest('[data-action], [role="tab"]');
    if (!target || target.disabled) return;
    if (target.getAttribute('role') === 'tab') { setView(target.dataset.view); return; }
    if (target === els.studyCard && swipe.justSwiped) { swipe.justSwiped = false; return; }

    const { action, cardId, deckId } = target.dataset;
    const deck = singleDeck();

    switch (action) {
      case 'new-deck': openDeckModal(); break;
      case 'select-deck': {
        const already = state.selectedDeckIds.length === 1 && state.selectedDeckIds[0] === deckId;
        if (!already) {
          setSelection([deckId]);
          // The sidebar was re-rendered; put focus back on the (new) button for this deck.
          const btn = els.deckList.querySelector(`[data-deck-id="${CSS.escape(deckId)}"]`);
          if (btn) btn.focus();
        }
        break;
      }
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

      case 'toggle-deck-filter': toggleFilter(); break;
      case 'filter-all': {
        setSelection(state.decks.map((d) => d.id));
        for (const box of els.deckFilterList.querySelectorAll('input')) box.checked = true;
        break;
      }
      case 'filter-close': toggleFilter(false, { returnFocus: true }); break;
      case 'show-mastered': setHideMastered(false); els.hideMastered.focus(); break;

      case 'new-card': openCardModal(); break;
      case 'edit-card': {
        const found = findCard(cardId);
        if (found) openCardModal(found.card, found.deck.id);
        break;
      }
      case 'delete-card': {
        const found = findCard(cardId);
        if (found) {
          confirmDelete({
            title: 'Delete this card?',
            description: `“${truncate(found.card.front, 80)}” will be removed from ${found.deck.name}.`,
            onConfirm: () => deleteCard(cardId),
            fallbackFocus: state.view === 'study' ? '#flip-btn, [data-action="new-card"]' : '#card-grid [data-action="study-card"], [data-action="new-card"]',
          });
        }
        break;
      }
      case 'reset-progress': resetProgress(cardId); break;
      case 'study-card': studyCard(cardId); break;
      case 'load-more': loadMore(); break;

      case 'know': review(+1); break;
      case 'still-learning': review(-1); break;
      case 'flip': flip(); break;
      case 'prev': goTo(ui.index - 1); break;
      case 'next': nextOrRestart(); break;
      case 'shuffle': toggleShuffle(); break;
      case 'clear-search': clearSearch(); els.search.focus(); break;

      case 'modal-cancel': closeModal(); break;
      default: break;
    }
  });

  // Deck filter checkboxes (multi-select).
  els.deckFilterList.addEventListener('change', () => {
    const checked = new Set([...els.deckFilterList.querySelectorAll('input:checked')].map((i) => i.value));
    setSelection(state.decks.filter((d) => checked.has(d.id)).map((d) => d.id));
  });
  // Close the filter when keyboard focus leaves it.
  els.deckFilter.addEventListener('focusout', (e) => {
    if (ui.filterOpen && e.relatedTarget && !els.deckFilter.contains(e.relatedTarget)) toggleFilter(false);
  });

  els.hideMastered.addEventListener('change', () => setHideMastered(els.hideMastered.checked));

  // Modal form: one submit listener; the current handler lives in modal.onSubmit.
  els.modalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!modal.onSubmit) return;
    const values = {};
    for (const field of els.modalFields.querySelectorAll('input, textarea, select')) {
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

  // Backdrop click closes — but only if the press *started* on the backdrop.
  els.modalRoot.addEventListener('pointerdown', (e) => { modal.pointerDownOnBackdrop = e.target === els.modalRoot; });
  els.modalRoot.addEventListener('click', (e) => {
    if (e.target === els.modalRoot && modal.pointerDownOnBackdrop) closeModal();
  });

  // Keyboard: modal → filter → tabs → typing → study shortcuts.
  document.addEventListener('keydown', (e) => {
    if (ui.isModalOpen) { handleModalKeydown(e); return; }
    if (e.key === 'Escape' && ui.filterOpen) { e.preventDefault(); toggleFilter(false, { returnFocus: true }); return; }
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;

    const t = e.target;

    // ARIA tabs: arrows / Home / End move between tabs (automatic activation).
    if (t.getAttribute && t.getAttribute('role') === 'tab') {
      const map = { ArrowLeft: 'study', ArrowRight: 'all', Home: 'study', End: 'all' };
      if (map[e.key]) {
        e.preventDefault();
        const target = e.key === 'ArrowLeft' || e.key === 'ArrowRight'
          ? (state.view === 'study' ? 'all' : 'study')   // two tabs: arrows wrap
          : map[e.key];
        setView(target, { focusTab: true });
      }
      return;
    }

    const typing = t.closest && t.closest('input, textarea, select, [contenteditable="true"]');
    if (typing) {
      if (t === els.search && e.key === 'Escape' && els.search.value) { e.preventDefault(); clearSearch(); }
      return;
    }
    if (state.view !== 'study' || !visibleCards().length) return;

    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); goTo(ui.index - 1); break;
      case 'ArrowRight': e.preventDefault(); goTo(ui.index + 1); break;
      case 'k': case 'K': e.preventDefault(); review(+1); break;
      case 'l': case 'L': e.preventDefault(); review(-1); break;
      case ' ':
      case 'Spacebar':
        // On a focused button, Space should press that button (native behaviour), not also flip.
        if (t.closest('button, a[href], summary, label')) return;
        e.preventDefault();
        flip();
        break;
      default: break;
    }
  });

  // Swipe left/right on the study card (touch, pen or mouse drag). A tap still flips.
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
    ui.shown = PAGE_SIZE;
    resetFlip();
    renderMain();
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
    Object.assign(state, loadState());
    syncOrder();
    render();
    announce('Decks updated from another tab.');
  });

  /* ------------------------------------------------------------------ Start */

  function seedSampleDecks() {
    const make = (name, color, pairs) => {
      const deck = { id: uid(), name, color, createdAt: Date.now() };
      state.decks.push(deck);
      state.cardsByDeckId[deck.id] = pairs.map(([front, back, mastery = 0]) => ({ id: uid(), front, back, mastery, updatedAt: Date.now() }));
      return deck;
    };
    const web = make('Web Basics', 'lavender', [
      ['What does HTML stand for?', 'HyperText Markup Language', 5],
      ['Which CSS property creates a 3D flip?', 'transform: rotateY(180deg) — with perspective on the parent and backface-visibility: hidden on each face.', 2],
      ['What does localStorage store?', 'Strings only — objects must be JSON.stringify’d and JSON.parse’d.', 3],
      ['What is event delegation?', 'One listener on a parent handles events from its children via event.target.closest().', 1],
      ['What does aria-live="polite" do?', 'Screen readers announce changes to that region when the user is idle.'],
      ['What does the inert attribute do?', 'Makes an element and its children unclickable, unfocusable and hidden from screen readers.'],
    ]);
    make('Japanese Verbs', 'pink', [
      ['食べる (たべる)', 'to eat', 5],
      ['飲む (のむ)', 'to drink', 4],
      ['見る (みる)', 'to see / to watch', 2],
      ['行く (いく)', 'to go'],
      ['来る (くる)', 'to come'],
      ['書く (かく)', 'to write'],
    ]);
    state.selectedDeckIds = [web.id];
    persist();
  }

  if (isFirstVisit && state.decks.length === 0) seedSampleDecks();
  render();
})();