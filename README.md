# Flashcards Study App

A single-page flashcards app in plain HTML, CSS, and JavaScript. It needs no frameworks and no build step.

**Run it:** open `index.html` in a browser. You can also serve the folder with any static server (for example VS Code Live Server) or with GitHub Pages.

## Features

- **Decks as categories:** create, edit (name and color), and delete decks. Deleting asks for confirmation. Each deck has one of five pastel colors, which tints its sidebar chip, header, cards, and grid tiles.
- **Cards:** create, edit, and delete cards with a question, an answer, and a deck (category). Editing a card can move it to another deck. Validation messages appear if a field is missing.
- **Study mode:** one card at a time with a 3D flip ("Reveal answer"), Prev/Next, "Card 1 of N", a progress bar, and shuffle. On the last card, Next turns into "Start over". You can swipe the card left/right on phones and tablets.
- **Mastery tracking (0–5):** "I know this" raises a card's mastery by 1 and "Still learning" lowers it by 1. Either button then moves to the next card. Each card shows a 5-dot meter, and "Reset progress" starts a card over. "Hide mastered" removes 5/5 cards so you can focus on the rest.
- **Study statistics:** total, mastered, in progress, and not started counts, plus a stacked progress bar.
- **All cards view:** a responsive grid (1, 2, or 3 columns) showing each card's question, answer, deck, and mastery, with Study, Edit, Reset, and Delete buttons. It shows 12 cards at a time with a "Load more" button.
- **Multi-deck filter:** a dropdown with a checkbox and card count for each deck. Pick several decks to study them mixed together.
- **Search:** case-insensitive search of questions and answers, debounced to 300 ms, with a match count. Search only filters the view and never changes the saved data.
- **Persistence:** decks, cards, mastery, the selected decks, and the current view are saved to LocalStorage. The saved data is versioned: version 1 data migrates to version 2 automatically. Corrupt data never crashes the app; it starts fresh and keeps a backup. Changes made in another tab are synced.
- **Responsive:** phone (one column, deck chips you scroll sideways), tablet (two-column grid, stats in a row), and desktop (sticky deck sidebar, stats beside the study card, three-column grid).
- **Accessibility:** labelled inputs, buttons with discernible names, visible focus styles, and touch targets of 44 px or more. The modal traps focus, closes on Esc, returns focus to the button that opened it, and makes the page behind it `inert`. The tabs follow the ARIA tabs pattern (arrow keys, Home and End). The Hide mastered toggle is a real checkbox with `role="switch"`. Mastery meters have text alternatives, and a live region announces updates (toasts are visual only). The flip animation turns off under `prefers-reduced-motion`. Text colors meet WCAG AA in both light and dark themes.
- **Theme:** kawaii pastel design (bento tiles, soft claymorphism, Nunito and Quicksand fonts) with a dark "night garden" mode.
- **Extras:** keyboard shortcuts, and import/export of decks as JSON (mastery included).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Space` | Reveal or hide the answer (when focus isn't on a button or text field) |
| `←` / `→` | Previous / next card |
| `K` | I know this (+1 mastery) |
| `L` | Still learning (−1 mastery) |
| `←` / `→` on the tabs | Switch between Study mode and All cards |
| `Esc` | Close a dialog or the deck filter, or clear the search box |
| `Enter` / `Ctrl+Enter` | Submit a dialog from a single-line / multi-line field |
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
  version: 2,
  decks: [{ id, name, color, createdAt }],
  cardsByDeckId: { [deckId]: [{ id, front, back, mastery /* 0–5 */, updatedAt }] },
  activeDeckId: string | null,   // last active deck (first selected)
  selectedDeckIds: string[],     // decks currently being studied
  view: 'study' | 'all'
}

// Transient UI state (never saved)
ui = { query, order, index, isFlipped, isShuffled, hideMastered, shown, isModalOpen, filterOpen }
```

## Manual QA checklist

- [ ] Use the whole app with only the keyboard. Tab stays inside open dialogs, and Esc returns focus to where you were.
- [ ] Flip a card, then press Next. The new card shows its **front** right away, with no spin that reveals the answer.
- [ ] On the last card, Next turns into "Start over". On the first card, Prev is disabled and focus moves to the flip button.
- [ ] "I know this" / "Still learning" change the 5-dot meter and the stats. Turn on "Hide mastered" and mastered cards disappear.
- [ ] Tick two decks in the Decks filter: the title changes to "Mixed study" and each card shows its deck name.
- [ ] Resize to 375 px and 768 px wide: nothing scrolls sideways and every button is easy to tap.
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
