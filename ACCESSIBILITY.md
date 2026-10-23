# Accessibility

Blipdeck aims to be usable by everyone, whether you use a mouse, a keyboard, a touch screen or a screen reader. The target is [WCAG 2.1](https://www.w3.org/TR/WCAG21/) level AA.

## What's supported

- **Everything works from the keyboard.** Pads play with their own shortcuts, `Tab` reaches every control, and menus follow the usual keys (arrows, `Home`/`End`, `Enter`, `Esc`). Reordering, which is a drag with the mouse, is also in each pad's ⋯ menu (**Move earlier** / **Move later**), and the trim handles are sliders: arrows move them by 0.05 s, `Shift` + arrows by 0.5 s, `Home`/`End` to the edges.
- **Screen readers** get a name for every control, including icon-only buttons, and are told when recording starts or a recording is saved, when a shortcut is assigned or removed, and when a pad moves.
- **Contrast**: text meets the 4.5:1 ratio, including on the colored pads (which use dark text for that reason).
- **Visible focus**: a clear outline shows where the keyboard is.
- **Reduced motion**: with "reduce motion" turned on in your system settings, the app drops its animations.
- **Touch screens**: a tap plays, a swipe scrolls, and a long press lifts a pad to move it.
- **12 languages**, including right-to-left Arabic, with the page language set for screen readers.

## How it's checked

Every push runs [axe-core](https://github.com/dequelabs/axe-core) WCAG 2.1 AA checks on every view of the app (pads, menus, dialogs, key assignment, recording, the online demo, Arabic) in WebKit, Firefox and Chromium, together with tests for the keyboard paths, the announcements and reduced motion. See [`tests/a11y.spec.js`](tests/a11y.spec.js).

## Known limitations

- **No manual screen reader testing yet.** The app passes automated checks, but it hasn't been tried end to end with VoiceOver, NVDA or TalkBack by someone who uses them every day. Reports are especially welcome here.
- **The waveform is visual only.** In the trim window the start, end and length are available as numbers and slider values, but the shape of the sound isn't described.
- **Single-key shortcuts** (a pad's key, `R` to record) are on by default, as they're the point of a soundboard. They only fire when focus isn't in a text field, and any pad's shortcut can be removed (⋯ → Assign a keyboard shortcut → `Backspace`).
- **Browser dialogs** (rename, delete confirmation) are the browser's own, so their buttons follow the browser's language rather than the app's.

## Reporting a barrier

If something gets in your way, please [open an issue](https://github.com/azammarchi/blipdeck/issues/new/choose) and mention the browser, the assistive technology you use (if any) and what you were trying to do. Accessibility problems are treated as bugs.
