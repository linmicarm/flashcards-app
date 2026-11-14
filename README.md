# Flashcards Study App

A single-page flashcards app in plain HTML, CSS, and JavaScript. It needs no frameworks and no build step.

**Run it:** open `index.html` in a browser. You can also serve the folder with any static server (for example VS Code Live Server) or with GitHub Pages.

## Features

- **Decks:** create, rename, and delete decks (deleting asks for confirmation). The active deck is highlighted in the sidebar.
- **Cards:** create, edit, and delete cards. Each card has a front and a back. Edits update the study view right away.
- **Study mode:** a 3D flip animation, Previous/Next buttons that stop at the first and last card, a progress bar, and a Shuffle toggle. Shuffle only reorders the view and never changes the saved data.
- **Search:** case-insensitive search across the front and back of every card, debounced to 300 ms, with a match count.
- **Persistence:** decks, cards, and the last active deck are saved to LocalStorage. The saved data is versioned and validated on load. If it's corrupt, the app starts fresh and keeps a backup of the bad data instead of overwriting it. Changes made in another tab are picked up automatically.
- **Accessibility:** every input has a label. Buttons have discernible names (list buttons have aria-labels like "Edit card: …"), and focus styles are visible. The modal traps focus, closes on Esc, returns focus to the button that opened it, and makes the background `inert`. A live region announces status changes, and only the visible card face is exposed to screen readers. There's a skip link, touch targets are at least 44 px, and the flip animation is turned off under `prefers-reduced-motion`.
- **Theming:** colors are CSS variables with a dark theme through `prefers-color-scheme`. Color pairs were picked to meet WCAG AA.
- **Stretch goals:** keyboard shortcuts, plus import and export of decks as JSON.

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

> _Draft: edit each bullet so it matches what actually happened in your own AI sessions._

- **Where AI saved time:** The boilerplate came together in minutes: the semantic HTML shell, the CSS grid with variables and a dark theme, the 3D flip CSS, and the Fisher–Yates shuffle. That left my time for testing and fixing behavior, not typing layout code.
- **AI bug I found and fixed:** The flip state got out of sync. If you flipped a card and pressed Next, the generated code removed `.is-flipped`, so the card spun back to the front while already showing the next card's text. That gave away the answer. I fixed it in `resetFlip()`: it adds a `.no-transition` class, removes `.is-flipped`, forces a reflow (`void el.offsetWidth`), and then turns transitions back on. The card now jumps straight to the front. (A second bug: rendering card text with `innerHTML` let a card's content inject HTML. Every user string now goes through `textContent`.)
- **Refactor for clarity:** The first version attached `addEventListener` to every deck and card button inside the render functions, so listeners piled up after each re-render. I replaced all of them with one delegated handler: `document.addEventListener('click', e => { const t = e.target.closest('[data-action]'); switch (t.dataset.action) { … } })`. Each button now just declares a `data-action`, and nothing needs to be re-bound or cleaned up.
- **Accessibility improvement:** I made the modal fully keyboard-safe. It traps Tab and Shift+Tab, closes on Esc, and sets `inert` on the app behind it. It also returns focus to the opener. Because re-rendering replaces DOM nodes, it finds the opener again by its `data-action` and `data-card-id`, and falls back to a sensible control if the card was deleted. Confirm dialogs focus **Cancel** first, so pressing Enter can't delete anything by accident.
- **Prompt changes that improved output:** Vague prompts ("make a modal") produced code that looked right but was missing behavior. Results improved once I named the exact failure modes and constraints, for example: "focus trap that also handles Shift+Tab, return focus to opener, no innerHTML for user text, use event delegation with data-action attributes, don't mutate stored data when searching." Asking the AI to list the edge cases it hadn't handled was also useful.
