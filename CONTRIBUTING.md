# Contributing to Blipdeck

Thanks for taking the time to help! Bug reports, ideas, translations and code are all welcome.

## Reporting a bug or suggesting an idea

Open an [issue](https://github.com/azammarchi/blipdeck/issues/new/choose) and pick a template. For bugs, the most useful things to include are your browser and operating system, the steps to reproduce, and, for anything involving the keyboard, what the `?debug` panel shows (open the app with `?debug` at the end of the address).

Security problems are the exception: please report them privately, as described in [SECURITY.md](SECURITY.md).

## Working on the code

Blipdeck is plain HTML, CSS and JavaScript with no build step and no runtime dependencies. You need [Node.js](https://nodejs.org).

```bash
npm start            # runs the app at http://localhost:5173
npm install          # test tools only (Playwright, axe-core)
npm run test:install # the browsers the tests drive
npm test             # end-to-end tests in WebKit, Firefox and Chromium
```

Where things live:

| Path | What |
| --- | --- |
| `public/index.html` | Page structure, icons, dialogs |
| `public/app.js` | Everything the app does: storage, playback, pads, trimming, import/export |
| `public/i18n.js` | All interface text, in every language |
| `public/style.css` | Styles |
| `server.js` | Tiny local server (no dependencies) that also saves sounds into `sounds/` |
| `tests/` | Playwright end-to-end tests |

## Guidelines

- **English only** for code, comments, docs and commit messages. Interface text goes in `public/i18n.js`, never directly in HTML or JavaScript.
- **Keep it dependency-free.** The app must keep working by just serving `public/`.
- **Add or update tests** for what you change, using real mouse and keyboard input (`page.mouse`, `page.keyboard`) rather than synthetic events: synthetic events have hidden real browser bugs before.
- **Check every browser.** `npm test` runs WebKit (Safari's engine), Firefox and Chromium; CI runs the same suite on every pull request.
- **Keep it accessible.** New controls need a name (`data-i18n-label` for icon-only ones) and a keyboard path; `tests/a11y.spec.js` runs axe-core on every view. See [ACCESSIBILITY.md](ACCESSIBILITY.md).

### Translations

To change interface text, update the key in **every** language in `public/i18n.js` (a test fails if any language is missing a key). To add a language, copy the `en` block, set a new code, a `name` and a small SVG `flag`, and translate the strings; add `dir: 'rtl'` for right-to-left languages.

### Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org): `type(scope): description`.

- **type**: `feat`, `fix`, `docs`, `test`, `ci`, `chore`, `refactor`, `style`, `perf`
- **scope**: the area you worked on, e.g. `pads`, `audio`, `shortcuts`, `ui`, `i18n`, `server`, `demo`
- **description**: short and imperative, e.g. `fix(shortcuts): match keypad digits`

## Pull requests

Keep each pull request focused on one change, fill in the template, and make sure `npm test` passes. By contributing you agree that your work is released under the [MIT license](LICENSE) and that you'll follow the [code of conduct](CODE_OF_CONDUCT.md).
