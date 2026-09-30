v2.0.0 (2026-09-30)
----------------------------
New algorithm, rewritten in TypeScript. Solutions of version 1 are not accepted: update the server side (KnCaptcha-Php 2) at the same time.

### Proof of work
* **Equihash:** memory-hard puzzles (Equihash(96, 5) by default, about 10 MB per worker) instead of the BLAKE2b hashcash of version 1: GPUs and ASICs gain far less on them, the server checks a solution with 2^k hashes.
* **Stateless challenges:** signed with an HMAC, bound to a scope, with their own expiry. See PROTOCOL.md.
* **Difficulty:** leading zero bits and number of proofs set by the server for each challenge.
* **Solver:** pool of web workers (8 at most), main thread fallback when workers cannot start, standalone worker file for a CSP without `blob:`.

### Widget
* **One click:** "I'm not a robot" checkbox, or no click at all with the `focus` and `auto` start modes.
* **States:** idle, verifying (spinner and progress bar), verified, expired (shortly before the server would refuse the solution), error (click to retry).
* **Forms:** hidden input, `execute()`, `reset()`, callbacks.
* **Accessibility:** checkbox role, keyboard, announced status, reduced motion.
* **Vue 3 component** with v-model.

### Look
* **Base CSS** themable with CSS variables, `data-state` attribute, classes per part (Tailwind), dark mode with the Tailwind `dark` class.
* **Icons:** Tabler Icons, each replaceable.
* **Texts:** English (default) and French, `registerLocale()` for any other language (also after the widgets are displayed), `strings` per widget, language switch without losing the state (reactive in Vue).
