/*
 * storage.js — LocalStorage helpers with versioning and safe-parse fallback.
 * Exposes window.FlashStorage = { loadState, saveState, hasSavedState, parseImport, STORAGE_KEY }.
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'flashcards-app:state';
  const VERSION = 1;
  const MAX_NAME = 60;
  const MAX_TEXT = 1000;

  function defaultState() {
    return { version: VERSION, decks: [], cardsByDeckId: {}, activeDeckId: null };
  }

  const isString = (v) => typeof v === 'string';
  const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

  /** Keep only well-formed decks/cards so one bad record can't crash the app. */
  function sanitize(raw) {
    const clean = defaultState();
    if (!raw || typeof raw !== 'object') return clean;

    const decks = Array.isArray(raw.decks) ? raw.decks : [];
    const seen = new Set();
    for (const d of decks) {
      if (!d || !isString(d.id) || !isString(d.name) || seen.has(d.id)) continue;
      const name = d.name.trim().slice(0, MAX_NAME);
      if (!name) continue;
      seen.add(d.id);
      clean.decks.push({ id: d.id, name, createdAt: isNumber(d.createdAt) ? d.createdAt : Date.now() });
    }

    const byDeck = raw.cardsByDeckId && typeof raw.cardsByDeckId === 'object' ? raw.cardsByDeckId : {};
    for (const deck of clean.decks) {
      const list = Array.isArray(byDeck[deck.id]) ? byDeck[deck.id] : [];
      const cardIds = new Set();
      clean.cardsByDeckId[deck.id] = list
        .filter((c) => c && isString(c.id) && isString(c.front) && isString(c.back) && !cardIds.has(c.id) && cardIds.add(c.id))
        .map((c) => ({
          id: c.id,
          front: c.front.slice(0, MAX_TEXT),
          back: c.back.slice(0, MAX_TEXT),
          updatedAt: isNumber(c.updatedAt) ? c.updatedAt : Date.now(),
        }));
    }

    clean.activeDeckId = seen.has(raw.activeDeckId) ? raw.activeDeckId : (clean.decks[0] ? clean.decks[0].id : null);
    return clean;
  }

  /** Upgrade older saved shapes to the current VERSION. Returns null if unknown. */
  function migrate(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.version === VERSION) return raw;
    // Example for the future: if (raw.version === 1) { ...transform...; raw.version = 2; }
    return null;
  }

  function hasSavedState() {
    try {
      return localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  function loadState() {
    let text = null;
    try {
      text = localStorage.getItem(STORAGE_KEY);
      if (text === null) return defaultState();
      const migrated = migrate(JSON.parse(text));
      if (!migrated) throw new Error('Unknown saved data version');
      return sanitize(migrated);
    } catch (err) {
      console.warn('[flashcards] Could not read saved data, starting fresh.', err);
      // Keep a copy of the unreadable data instead of silently overwriting it on the next save.
      try {
        if (text !== null) localStorage.setItem(`${STORAGE_KEY}:backup-${Date.now()}`, text);
      } catch { /* storage unavailable — nothing more we can do */ }
      return defaultState();
    }
  }

  /** Writes only persistent fields (never transient UI state). Returns true on success. */
  function saveState(state) {
    try {
      const payload = {
        version: VERSION,
        decks: state.decks,
        cardsByDeckId: state.cardsByDeckId,
        activeDeckId: state.activeDeckId,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return true;
    } catch (err) {
      console.error('[flashcards] Save failed', err);
      return false;
    }
  }

  /**
   * Accepts either a single-deck export ({ type: 'flashcards-deck', deck, cards })
   * or a full backup ({ decks, cardsByDeckId }). Returns [{ name, cards: [{ front, back }] }].
   * Throws an Error with a user-friendly message on bad input.
   */
  function parseImport(data) {
    const cleanCards = (cards) =>
      (Array.isArray(cards) ? cards : [])
        .filter((c) => c && isString(c.front) && isString(c.back) && (c.front.trim() || c.back.trim()))
        .map((c) => ({ front: c.front.trim().slice(0, MAX_TEXT), back: c.back.trim().slice(0, MAX_TEXT) }));

    if (data && data.type === 'flashcards-deck' && data.deck && isString(data.deck.name)) {
      const name = data.deck.name.trim().slice(0, MAX_NAME);
      if (!name) throw new Error('The deck in this file has no name.');
      return [{ name, cards: cleanCards(data.cards) }];
    }

    if (data && Array.isArray(data.decks)) {
      const s = sanitize({ ...data, version: VERSION });
      if (!s.decks.length) throw new Error('No valid decks were found in this file.');
      return s.decks.map((d) => ({ name: d.name, cards: cleanCards(s.cardsByDeckId[d.id]) }));
    }

    throw new Error('This file is not a Flashcards export.');
  }

  window.FlashStorage = { loadState, saveState, hasSavedState, parseImport, STORAGE_KEY, MAX_NAME, MAX_TEXT };
})();
