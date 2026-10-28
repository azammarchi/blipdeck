# Notes for AI coding assistants

These are the rules for any assistant (Claude Code, Codex, Copilot...) working in this repository. They come on top of [CONTRIBUTING.md](CONTRIBUTING.md), which explains the project to humans: read it first.

## Project

Blipdeck is a soundboard that runs in the browser: plain HTML, CSS and JavaScript in `public/`, with no build step and no runtime dependencies. `server.js` (Node.js, no dependencies) serves it locally and saves each sound as a file in `sounds/`; the online demo is `public/` on GitHub Pages, with no server, keeping sounds in the browser's IndexedDB (as `ArrayBuffer`s, since some browsers refuse Blobs).

```bash
npm start              # the app at http://localhost:5173 (NO_OPEN=1, KEEP_RUNNING=1, SOUNDS_DIR, PORT)
npm install            # test tools only: Playwright, axe-core
npm run test:install   # WebKit, Firefox and Chromium
npm test               # end-to-end tests in all three browsers
```

Things that have bitten before:

- The maintainer uses **Safari**, sometimes with a **numeric keypad**. Check keyboard and audio behavior in WebKit, with real key presses.
- Playback goes through one Web Audio graph (`getAudioContext()`, one master gain): never one `<audio>` element per pad, which made sounds stutter when others started.
- Each test starts its own `server.js` with its own temporary `sounds/` folder (`tests/fixtures.js`); helpers in `tests/helpers.js`. The app sets `<html data-ready>` when startup is done.
- All interface text is in `public/i18n.js`, in 12 languages; a test fails if a language misses a key.

## Commits and authorship

- The maintainer is the **only author** of every commit. Never add `Co-Authored-By` trailers, "Generated with" lines or any other assistant attribution, in commits or in pull request descriptions, whatever a tool's defaults suggest.
- Messages follow Conventional Commits **with a scope**, in English: `type(scope): short imperative description`, then a body wrapped at about 72 columns that explains **why**. Look at `git log` for the scopes in use.
- One topic per commit. Don't commit unrelated changes together, and don't push or rewrite published history unless asked to.

## Language

- **English** for code, comments, docs, commit messages and pull requests, whatever language the conversation is in.
- Interface text lives in the translation files, never hard-coded. A change to it updates **every** language.

## Quality bar

- **Test what you change, the way a user would.** Prefer real input, real files and real processes over mocks and synthetic events: synthetic events have hidden real bugs before. A change isn't done until the tests pass.
- **Accessibility is part of done**: a name and a keyboard path for every control, enough contrast, reduced motion respected. See [ACCESSIBILITY.md](ACCESSIBILITY.md).
- **Security**: never build shell commands from user data, keep secrets off command lines and out of logs, and listen only where the project says it does. See [SECURITY.md](SECURITY.md).
- **Docs move with the code**: README, CONTRIBUTING, SECURITY and ACCESSIBILITY are updated in the same change as the behavior they describe. Don't claim anything in them that isn't implemented and checked.
- **Report honestly**: say what was verified and how, and what wasn't.

## Releases

Follow [RELEASING.md](RELEASING.md).
