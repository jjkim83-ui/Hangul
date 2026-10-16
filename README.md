# 한글 놀이터 · Korean games

Static website: hub + 4 games (memory, quiz, crossword, syllable puzzle) + word pool.
Open `index.html` in a browser (works offline too), or host the folder on GitHub Pages.

- `content/` — vocabulary (textbook 4-1, 267 words with DE/EN/Korean hints) and crossword bridge words.
  Each `.json` has a `.js` twin so the pages also work when opened directly from disk.
- `shared/` — page runtime, fonts (Jua, Nunito — bundled, no Google request), morphdom.
- Player list, settings and "today's words" are saved in the browser (localStorage).
