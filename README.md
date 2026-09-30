# KnCaptcha

Privacy-friendly "I'm not a robot" checkbox backed by a proof of work: the browser solves a memory-hard puzzle, the
server checks it in microseconds. No image to click, no third party, no cookie, no tracking.

- **One click** (or none): the user checks the box, the work runs in web workers, the box is checked.
- **Cheap for the server**: a challenge costs an HMAC and stores nothing, a solution costs about 25 µs to check in PHP.
- **Costly for bots**: Equihash, a memory-hard proof of work, where GPUs and ASICs gain far less than on a plain hash.
- **TypeScript, strict**, no runtime dependency: vanilla JS widget, Vue 3 component, base CSS with dark mode, Tabler
  icons.

The server side is [KnCaptcha-Php](https://github.com/Karewan/KnCaptcha-Php); [PROTOCOL.md](PROTOCOL.md) describes the
exchanges for any other server.

## Table of contents

- [How it works](#how-it-works)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Vue 3](#vue-3)
- [Options](#options)
- [Methods and properties](#methods-and-properties)
- [Styling](#styling)
- [Icons](#icons)
- [Texts](#texts)
- [Content Security Policy](#content-security-policy)
- [Security notes](#security-notes)
- [Development](#development)
- [License](#license)

## How it works

1. The widget fetches a challenge from your server: random salt, puzzle parameters and expiry, signed with an HMAC.
2. Up to 8 web workers run [Equihash](https://eprint.iacr.org/2015/946) (Biryukov & Khovratovich, NDSS 2016) until
   each proof has a solution whose hash starts with enough zero bits. Each run needs about 10 MB: Wagner's algorithm
   has to hold 131 072 hashes and sort them five times.
3. The solution goes to your server in a hidden input (or through a callback). The server checks the HMAC, the expiry
   and 2^k hashes per proof, then remembers the challenge so that it passes only once.

| Difficulty (PHP preset) | Equihash runs | Desktop, 8 cores | Phone (estimate) | Server check |
|-------------------------|--------------:|-----------------:|-----------------:|-------------:|
| `low`                   |            ~8 |          < 0.1 s |   ~0.5 s   |      ~25 µs  |
| `medium` (default)      |           ~32 |          ~0.2 s  |    1–2 s   |      ~25 µs  |
| `high`                  |          ~128 |          ~0.5 s  |    4–8 s   |      ~25 µs  |

A proof of work does not tell a human from a bot: it makes each attempt cost CPU time and memory, which slows down
credential stuffing, spam and scraping without bothering users. Raise the difficulty with the failed attempts.

## Installation

```shell
pnpm add kncaptcha
```

Or with a `<script>` tag: `dist/kncaptcha.iife.js` defines `window.KnCaptcha`, `dist/kncaptcha.css` is the base style.

## Quick start

```html
<form method="post" action="/login">
	<input name="username" />
	<input name="password" type="password" />
	<div id="captcha"></div>
	<button>Sign in</button>
</form>
```

```ts
import { KnCaptcha } from 'kncaptcha';
import 'kncaptcha/style.css';

const captcha = new KnCaptcha('#captcha', {
	challenge: '/captcha/challenge',
	onVerify: (solution) => console.log('ready to submit'),
});
```

The widget adds a hidden `kncaptcha` input to the form. The endpoint answers `{"challenge": "..."}` (or the challenge as
plain text); with KnCaptcha-Php:

```php
echo json_encode(['challenge' => $captcha->createChallenge('login')]);
// then, on POST /login
if (!$captcha->verify($_POST['kncaptcha'] ?? '', 'login')) { /* refuse */ }
```

Without a bundler:

```html
<link rel="stylesheet" href="/js/kncaptcha.css" />
<script src="/js/kncaptcha.iife.js"></script>
<script>
	const captcha = new KnCaptcha('#captcha', { challenge: '/captcha/challenge', lang: 'fr' });
</script>
```

For an AJAX form, read the solution from the callback or with `await captcha.execute()`, and call `captcha.reset()`
after each submission: the server accepts a solution once.

## Vue 3

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { KnCaptcha } from 'kncaptcha/vue';
import 'kncaptcha/style.css';

const solution = ref('');

async function submit() {
	await api.post('/login', { ...form, kncaptcha: solution.value });
	solution.value = ''; // clearing v-model resets the widget
}
</script>

<template>
	<KnCaptcha v-model="solution" challenge="/captcha/challenge" lang="fr" @error="report" />
	<button :disabled="!solution" @click="submit">Sign in</button>
</template>
```

The props are the [options](#options) (without the callbacks), the events are `verify`, `expire`, `error`,
`state-change` and `progress`. A template ref exposes `start()`, `reset()` and `execute()`. `lang`, `strings`, `icons`
and `classes` follow their changes, in any state: bind `lang` to the locale of the application (vue-i18n...) and the
widget switches language without losing its solution.

## Options

| Option        | Type                                                   | Default               | Description                                                                          |
|---------------|--------------------------------------------------------|-----------------------|--------------------------------------------------------------------------------------|
| `challenge`   | `string \| URL \| (signal: AbortSignal) => Promise<string>` | required         | Challenge endpoint (GET), or a function returning the challenge (your HTTP client)   |
| `fetchInit`   | `RequestInit`                                          |                       | fetch() options of the endpoint: headers, credentials...                            |
| `start`       | `'click' \| 'focus' \| 'auto'`                         | `'click'`             | See below                                                                            |
| `name`        | `string \| null`                                       | `'kncaptcha'`         | Name of the hidden input, `null` for none                                            |
| `lang`        | `string`                                               | `'en'`                | `en`, `fr`, or a language added with `registerLocale()`, see [Texts](#texts)        |
| `strings`     | `Partial<KnCaptchaStrings>`                            |                       | Replaces some texts                                                                  |
| `icons`       | `Partial<KnCaptchaIcons>`                              | Tabler icons          | Replaces some icons, see [Icons](#icons)                                            |
| `classes`     | `Partial<Record<KnCaptchaPart, string>>`               |                       | Classes added to the parts: `root`, `box`, `body`, `label`, `status`, `logo`, `progress`, `bar` |
| `workers`     | `number`                                               | cores, 8 at most      | Web workers of the proof of work                                                     |
| `workerUrl`   | `string \| URL`                                        |                       | URL of `dist/kncaptcha.worker.js`, see [CSP](#content-security-policy)              |
| `minDuration` | `number`                                               | `500`                 | Minimum time of the verifying state (ms), so that a fast solve does not flicker     |
| `onStateChange`, `onVerify`, `onExpire`, `onError`, `onProgress` | callbacks |            | State, solution, expiry, `KnCaptchaError`, estimated progress from 0 to 1            |

Start modes:

- `click`: the user checks the box (default).
- `focus`: the work starts as soon as the form around the widget gets the focus, while the user types. The box is
  usually checked before the form is filled. Without a form around the widget, it waits for a click.
- `auto`: the work starts right away. `focus` and `auto` also start again by themselves after an expiry or a reset.

States: `idle`, `verifying`, `verified`, `expired`, `error`. A solution expires shortly before the challenge (10% of its
lifetime, 30 s at most, measured on the browser clock); the box can then be checked again. After an error, a click
retries.

Errors are `KnCaptchaError` with a `code`: `network` (the challenge could not be fetched), `challenge` (invalid
answer from the server), `solver` (the proof of work failed).

## Methods and properties

| Member                     | Description                                                                                          |
|----------------------------|------------------------------------------------------------------------------------------------------|
| `start()`                  | Starts the verification, unless it is running or done                                                |
| `execute(): Promise<string>` | The solution, once verified (starts if needed). Rejects with a `KnCaptchaError`, or an `AbortError` on reset/destroy |
| `reset()`                  | Forgets the solution, back to the unchecked box                                                      |
| `setOptions(options)`      | Changes `lang`, `strings`, `icons`, `classes`                                                        |
| `destroy()`                | Stops the work and removes the widget                                                                |
| `state`, `solution`, `element` | Current state, solution (empty until verified), root element                                     |
| `KnCaptcha.version`, `KnCaptcha.locales`, `KnCaptcha.icons` | Static: version, texts by language, default icons                   |
| `KnCaptcha.registerLocale(lang, strings)` | Static: adds a language, same as `registerLocale()`                                  |

## Styling

Import `kncaptcha/style.css` (or link `dist/kncaptcha.css`, `dist/kncaptcha.min.css`). Everything is themable with
CSS variables on `.knc`:

```css
.knc {
	--knc-accent: #9333ea;   /* spinner, progress bar */
	--knc-success: #16a34a;  /* checked box */
	--knc-radius: 999px;
	max-width: none;
}
```

| Variable                                                          | Role                                   |
|-------------------------------------------------------------------|----------------------------------------|
| `--knc-bg`, `--knc-bg-hover`, `--knc-fg`, `--knc-muted`, `--knc-border` | Colors                           |
| `--knc-accent`, `--knc-success`, `--knc-warning`, `--knc-danger`, `--knc-focus` | State colors, focus ring   |
| `--knc-radius`, `--knc-padding`, `--knc-gap`, `--knc-font-size`   | Box                                    |
| `--knc-box-size`, `--knc-logo-size`, `--knc-progress-height`      | Sizes                                  |

The root carries `data-state`: `.knc[data-state="verified"]`, or with Tailwind `data-[state=verified]:ring-2`. The
`classes` option adds utility classes to each part:

```ts
new KnCaptcha('#captcha', {
	challenge: '/captcha/challenge',
	classes: { root: 'max-w-none shadow-sm', label: 'font-semibold' },
});
```

**Dark mode** follows the Tailwind `dark` class, on an ancestor (usually `<html class="dark">`) or on the widget
itself. To follow the system instead, toggle that class from `prefers-color-scheme`.

The spinner and the transitions stop with `prefers-reduced-motion`. The box is a `role="checkbox"` button, reachable
with the keyboard, labelled by the text; the status is announced (`aria-live`).

## Icons

The default icons come from [Tabler Icons](https://tabler.io/icons) (MIT): `square`, `loader-2`, `square-check`
(filled), `refresh`, `alert-triangle` and `shield-check`. Replace any of them with SVG markup, an empty string hides
it:

```ts
new KnCaptcha('#captcha', {
	challenge: '/captcha/challenge',
	icons: {
		checkbox: '<svg viewBox="0 0 24 24">…</svg>', // idle
		spinner: '…',  // verifying, rotated by the CSS
		checked: '…',  // verified
		expired: '…',
		error: '…',
		logo: '',      // no logo
	},
});
```

Icons are inserted as HTML: only pass trusted markup. Use `stroke="currentColor"` or `fill="currentColor"` so that
they take the state colors. `pnpm icons` regenerates `src/icons.ts` from the `@tabler/icons` package.

## Texts

Built-in: English (the default) and French. The widget does not look at the language of the page or of the browser:
give `lang`. A regional tag falls back on its base language (`fr-CA` → `fr`), an unknown one on English. The root of the
widget gets the matching `lang` attribute, so that screen readers pronounce its texts right.

Any other language takes one call, once, anywhere before or after the widgets are displayed (those that asked for it
switch at once):

```ts
import { type KnCaptchaStrings, registerLocale } from 'kncaptcha';

const german: KnCaptchaStrings = {
	label: 'Ich bin kein Roboter',
	verifying: 'Überprüfung läuft…',
	verified: 'Überprüft',
	expired: 'Überprüfung abgelaufen, bitte erneut ankreuzen',
	error: 'Überprüfung fehlgeschlagen, zum Wiederholen klicken',
	logo: 'Geschützt durch KnCaptcha, ohne Cookies und Tracking',
};
registerLocale('de', german);

new KnCaptcha('#captcha', { challenge: '/captcha/challenge', lang: 'de' });
```

`KnCaptchaStrings` makes TypeScript check that no text is missing; in JavaScript, a missing text shows in English.
`registerLocale('fr-ca', ...)` adds a regional variant, `registerLocale('fr', ...)` replaces a built-in language. It is
also exported by `kncaptcha/vue`, and is `KnCaptcha.registerLocale()` with the `<script>` build.

For one widget only, `strings` replaces some texts of its language:

```ts
new KnCaptcha('#captcha', {
	challenge: '/captcha/challenge',
	lang: 'fr',
	strings: { label: 'Je suis un humain' },
});
```

Keys: `label`, `verifying`, `verified`, `expired`, `error`, `logo` (tooltip of the logo). `setOptions({ lang, strings })`
changes them on a displayed widget, in any state.

## Content Security Policy

The workers are started from a `blob:` URL: the CSP needs `worker-src 'self' blob:`. Otherwise, serve
`dist/kncaptcha.worker.js` yourself and give its URL:

```ts
new KnCaptcha('#captcha', { challenge: '/captcha/challenge', workerUrl: '/js/kncaptcha.worker.js' });
```

When no worker can start at all, the work runs on the main thread, one run at a time: slower, the page stays usable.

## Security notes

- The server decides everything: parameters, difficulty and expiry are signed, the browser cannot lower them.
- A solution passes once, and only for its scope (`createChallenge('login')` / `verify($solution, 'login')`).
- The widget does not look at the user agent or at `navigator.webdriver`: such checks stop nobody and break your own
  end-to-end tests.
- Keep other defenses: rate limits, account lockouts. Raise the difficulty for an IP address that fails a lot.

## Development

```shell
pnpm install
pnpm test         # Vitest: solver, protocol, widget (happy-dom), Vue component
pnpm typecheck
pnpm lint         # Biome: format, lint and imports (biome.json); pnpm lint:fix applies the safe fixes
pnpm dev          # demo pages: http://localhost:5173/demo/
pnpm build        # dist/: ES modules, IIFE, standalone worker, types, CSS
pnpm bench        # Equihash runs per second in Node
pnpm vectors      # rewrites tests/vectors.json, shared with the PHP tests
pnpm icons        # regenerates src/icons.ts from @tabler/icons, formatted by Biome
```

The demo pages talk to a TypeScript reference server (in `tests/support/server.ts`) or, through a proxy on `/php`, to
`php -S 127.0.0.1:8081 examples/server.php` run in the KnCaptcha-Php repository.

## License

MIT, see [LICENSE.txt](LICENSE.txt). Icons: Tabler Icons, MIT License, Copyright (c) 2020-2026 Paweł Kuna.
