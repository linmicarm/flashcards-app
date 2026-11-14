# Flashcards Study App

A single-page flashcards app in plain HTML, CSS, and JavaScript. It needs no frameworks and no build step.

**Run it:** open `index.html` in a browser. You can also serve the folder with any static server (for example VS Code Live Server) or with GitHub Pages.

## Features

- **Decks:** create, rename/recolor, and delete decks (deleting asks for confirmation). The active deck is highlighted in the sidebar.
- **Cards:** create, edit, and delete cards. Each card has a front and a back. Edits update the study view right away.
- **Study mode:** a 3D flip animation, Previous/Next buttons that stop at the first and last card, a progress bar, and a Shuffle toggle. Shuffle only reorders the view and never changes the saved data.
- **Search:** case-insensitive search across the front and back of every card, debounced to 300 ms, with a match count.
- **Persistence:** decks, cards, and the last active deck are saved to LocalStorage. The saved data is versioned and validated on load. If it's corrupt, the app starts fresh and keeps a backup of the bad data instead of overwriting it. Changes made in another tab are picked up automatically.
- **Accessibility:** every input has a label. Buttons have discernible names (list buttons have aria-labels like "Edit card: …"), and focus styles are visible. The modal traps focus, closes on Esc, returns focus to the button that opened it, and makes the background `inert`. A live region announces status changes, and only the visible card face is exposed to screen readers. There's a skip link, touch targets are at least 44 px, and the flip animation is turned off under `prefers-reduced-motion`.
- **Theming:** colors are CSS variables with a dark theme through `prefers-color-scheme`. Color pairs were picked to meet WCAG AA.
- **Stretch goals:** keyboard shortcuts, import/export of decks as JSON, and per-deck session stats (cards, seen, flips).
- **UI/UX:** a kawaii pastel theme (bento layout, soft claymorphism, Nunito/Quicksand fonts). Each deck gets one of five colors, which tints its sidebar chip, header and study card. You can swipe the card left/right on a phone, and a tap still flips it. Small toast messages confirm each action, and screen readers announce the same message. On the last card, Next turns into "Start over".

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Flip the card (when focus isn't on a button or text field) |
| `←` / `→` | Previous / next card |
| `Esc` | Close the dialog, or clear the search box |
| `Enter` | Submit a dialog from a single-line field |
| `Ctrl/⌘ + Enter` | Submit a dialog from a multi-line field |
| `Tab` / `Shift+Tab` | Move focus (stays inside an open dialog) |

## File structure

```
flashcards-app/
├── index.html   # semantic shell: header, nav (decks), main (study), footer, modal
├── styles.css   # CSS variables, responsive grid, flip animation, dark mode
├── storage.js   # loadState / saveState with versioning, validation, import parsing
└── app.js       # state, rendering, actions, modal, one delegated click handler
```

## Data model

```js
// Persisted (LocalStorage key "flashcards-app:state")
{
  version: 1,
  decks: [{ id, name, createdAt }],
  cardsByDeckId: { [deckId]: [{ id, front, back, updatedAt }] },
  activeDeckId: string | null
}

// Transient UI state (never saved)
ui = { query, order /* card ids in study order */, index, isFlipped, isShuffled, isModalOpen }
```

## Manual QA checklist

- [ ] Use the whole app with only the keyboard. Tab stays inside open dialogs, and Esc returns focus to where you were.
- [ ] Flip a card, then press Next. The new card shows its **front** right away, with no spin that reveals the answer.
- [ ] On the last card, Next is disabled and focus moves to Flip instead of getting lost.
- [ ] Search "xyz" shows the "No cards found" state. Clearing the search restores the full set.
- [ ] Refresh the page: decks, cards, and the active deck are all still there.
- [ ] In DevTools, run `localStorage.setItem('flashcards-app:state', '{bad')` and reload. The app starts empty and doesn't crash.
- [ ] Add a card whose front is `<img src=x onerror=alert(1)>`. It shows up as plain text and no alert appears.
- [ ] Turn on dark mode and reduced motion in your OS or in DevTools rendering emulation.

---

## Reflection

I built this with Claude as my AI coding assistant. I gave it the full lab spec, including the "AI inconsistency watch" notes, then reviewed, tested, and corrected what it produced.

- **Where AI saved time:** One prompt with the full spec produced about 1,800 lines across `index.html`, `styles.css`, `app.js`, and `storage.js` in minutes. That covered the semantic layout, the CSS variable theme with dark mode, the 3D flip, the modal, and the LocalStorage helpers. My time went into running and checking the app (keyboard-only use, reload, corrupted storage, mobile and desktop screenshots) instead of writing boilerplate.
- **AI bug I found and fixed:** The first version of `createCard()` called `cardsOf(deck.id).push(card)`. `cardsOf()` returns a brand-new empty array whenever a deck has no card list yet, so the push wrote to a throwaway array and the new card could silently disappear. The fix makes sure the deck's array exists first and pushes into the real stored array. A second bug was visual: screenshots showed the "+ New card" button label wrapping onto two lines on desktop, which I fixed by adding `white-space: nowrap` to `.btn`.
- **Refactor for clarity:**
  ```js
  // Before: easy to misread; the push can land on a temporary array
  cardsOf(deck.id).push(card);
  if (!state.cardsByDeckId[deck.id]) state.cardsByDeckId[deck.id] = [card];

  // After: create the stored array if needed, then push into it
  if (!state.cardsByDeckId[deck.id]) state.cardsByDeckId[deck.id] = [];
  state.cardsByDeckId[deck.id].push(card);
  ```
- **Accessibility improvement:** Keyboard focus never gets lost. On the last card, the Next button becomes disabled, which would normally drop focus to the page body, so focus moves to Flip instead. The modal traps Tab and Shift+Tab, closes on Esc, and makes the page behind it `inert`. When it closes, focus goes back to the button that opened it. Re-renders replace that button, so the app finds it again by its `data-action` and card id. Delete confirmations focus **Cancel** first, so pressing Enter can't delete anything by accident. I checked all of this with automated keyboard tests.
- **What prompt changes improved AI output:** Pasting the whole spec, including the list of common AI failure modes, worked much better than short prompts like "make a modal." The generated code handled those failure modes from the start: delegated listeners, resetting the flip on navigation, `textContent` instead of `innerHTML`, and safe JSON parsing. Asking the AI to run the app in a headless browser and screenshot it caught the wrapping bug that reading the code missed. One lesson from that: a dark-mode screenshot first looked broken, but it was only captured mid-transition. A short wait before re-checking proved it wasn't a real bug, so I verify before "fixing."
