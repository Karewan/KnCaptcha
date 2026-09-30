import { type Challenge, encodeSolution, parseChallenge } from "./challenge";
import { KnCaptchaError } from "./errors";
import { type KnCaptchaIcons, tablerIcons } from "./icons";
import {
	type KnCaptchaStrings,
	locales,
	onLocalesChange,
	registerLocale,
	resolveLang,
	resolveStrings,
} from "./locales";
import { defaultWorkerCount, type Solver, WorkerSolver } from "./solver/pool";

export const VERSION = "2.0.0";

export type KnCaptchaState = "idle" | "verifying" | "verified" | "expired" | "error";

/**
 * - `click`: the user checks the box
 * - `focus`: starts when the form around the widget gets the focus, the work is done while the user types
 * - `auto`: starts right away
 */
export type StartMode = "click" | "focus" | "auto";

/** URL of the challenge endpoint, or a function that returns a challenge */
export type ChallengeSource = string | URL | ((signal: AbortSignal) => Promise<string>);

export type KnCaptchaPart =
	| "root"
	| "box"
	| "body"
	| "label"
	| "status"
	| "logo"
	| "progress"
	| "bar";

export interface KnCaptchaOptions {
	/**
	 * URL of the challenge endpoint, fetched with GET, answering `{"challenge": "..."}` or the challenge as plain text.
	 * Or a function returning the challenge (to fetch it with your own HTTP client).
	 */
	challenge: ChallengeSource;
	/** fetch() options for the challenge URL: headers, credentials... */
	fetchInit?: RequestInit | undefined;
	/** Default: `click` */
	start?: StartMode | undefined;
	/** Name of the hidden input carrying the solution in the form, null for none. Default: `kncaptcha` */
	name?: string | null | undefined;
	/**
	 * Language of the texts: `en` (default), `fr`, or a language added with registerLocale(). A regional tag falls back
	 * on its base language (`fr-CA` → `fr`), an unknown one on English.
	 */
	lang?: string | undefined;
	/** Replaces some texts */
	strings?: Partial<KnCaptchaStrings> | undefined;
	/** Replaces some icons (SVG markup, trusted) */
	icons?: Partial<KnCaptchaIcons> | undefined;
	/** Classes added to the parts of the widget, e.g. Tailwind utilities */
	classes?: Partial<Record<KnCaptchaPart, string>> | undefined;
	/** Web workers of the proof of work. Default: logical cores, 8 at most */
	workers?: number | undefined;
	/** URL of `dist/kncaptcha.worker.js`, for a CSP without `worker-src blob:` */
	workerUrl?: string | URL | undefined;
	/** Minimum duration of the verifying state (ms), so that a fast solve does not flicker. Default: 500 */
	minDuration?: number | undefined;
	/** Replaces the proof of work (tests) */
	solver?: Solver | undefined;
	onStateChange?: ((state: KnCaptchaState) => void) | undefined;
	onVerify?: ((solution: string) => void) | undefined;
	onExpire?: (() => void) | undefined;
	onError?: ((error: KnCaptchaError) => void) | undefined;
	/** Estimated progress of the proof of work, from 0 to 1 */
	onProgress?: ((progress: number) => void) | undefined;
}

/** Options that can change after the creation */
export type KnCaptchaDisplayOptions = Pick<
	KnCaptchaOptions,
	"lang" | "strings" | "icons" | "classes"
>;

const STATE_ICONS: Record<KnCaptchaState, keyof KnCaptchaIcons> = {
	idle: "checkbox",
	verifying: "spinner",
	verified: "checked",
	expired: "expired",
	error: "error",
};

let instances = 0;

/**
 * "I'm not a robot" checkbox backed by a proof of work
 *
 *     const captcha = new KnCaptcha('#captcha', { challenge: '/captcha/challenge' });
 */
export class KnCaptcha {
	static readonly version = VERSION;
	static readonly locales = locales;
	static readonly icons = tablerIcons;
	/** Adds a language, see registerLocale() */
	static readonly registerLocale = registerLocale;

	private readonly options: KnCaptchaOptions;
	private readonly solver: Solver;
	private readonly root: HTMLDivElement;
	private readonly box: HTMLButtonElement;
	private readonly body: HTMLDivElement;
	private readonly label: HTMLSpanElement;
	private readonly status: HTMLSpanElement;
	private readonly logo: HTMLSpanElement;
	private readonly progressTrack: HTMLSpanElement;
	private readonly bar: HTMLSpanElement;
	private readonly input: HTMLInputElement | null;
	private readonly form: HTMLFormElement | null;
	private strings: KnCaptchaStrings;
	private icons: KnCaptchaIcons;
	private currentState: KnCaptchaState = "idle";
	private currentSolution = "";
	private controller: AbortController | null = null;
	private running: Promise<string> | null = null;
	private expiryTimer: ReturnType<typeof setTimeout> | undefined;
	/** The work started once: from then on, the automatic modes restart it after an expiry or a reset */
	private activated = false;
	private destroyed = false;
	private readonly stopLocales: () => void;

	/**
	 * @param target element (or selector) the widget is appended to
	 * @param options
	 */
	constructor(target: HTMLElement | string, options: KnCaptchaOptions) {
		const container =
			typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
		if (container === null) {
			throw new TypeError(`KnCaptcha: no element matches ${String(target)}`);
		}
		this.options = {
			...options,
		};
		this.solver =
			options.solver ??
			new WorkerSolver(options.workers ?? defaultWorkerCount(), options.workerUrl ?? null);
		this.strings = resolveStrings(options.lang, options.strings);
		this.icons = {
			...tablerIcons,
			...options.icons,
		};

		const id = `knc-${++instances}`;
		this.root = document.createElement("div");
		this.box = document.createElement("button");
		this.body = document.createElement("div");
		this.label = document.createElement("span");
		this.status = document.createElement("span");
		this.logo = document.createElement("span");
		this.progressTrack = document.createElement("span");
		this.bar = document.createElement("span");

		this.box.type = "button";
		this.box.setAttribute("role", "checkbox");
		this.box.setAttribute("aria-labelledby", `${id}-label`);
		this.box.setAttribute("aria-describedby", `${id}-status`);
		this.label.id = `${id}-label`;
		this.status.id = `${id}-status`;
		this.status.setAttribute("aria-live", "polite");
		this.logo.setAttribute("aria-hidden", "true");
		this.progressTrack.setAttribute("aria-hidden", "true");
		this.progressTrack.append(this.bar);
		this.body.append(this.label, this.status);
		this.root.append(this.box, this.body, this.logo, this.progressTrack);

		const name = options.name === undefined ? "kncaptcha" : options.name;
		this.input = null;
		if (name !== null) {
			this.input = document.createElement("input");
			this.input.type = "hidden";
			this.input.name = name;
			this.root.append(this.input);
		}

		this.applyClasses();
		this.render();
		this.root.addEventListener("click", this.onClick);
		// A language registered later shows at once, if this widget asked for it
		this.stopLocales = onLocalesChange(this.refreshStrings);
		container.append(this.root);

		this.form = this.root.closest("form");
		const start = options.start ?? "click";
		if (start === "auto") {
			this.start();
		} else if (start === "focus") {
			this.form?.addEventListener("focusin", this.onFormFocus);
		}
	}

	get state(): KnCaptchaState {
		return this.currentState;
	}

	/** Solution to send to the server, empty until verified */
	get solution(): string {
		return this.currentSolution;
	}

	/** The root element of the widget */
	get element(): HTMLDivElement {
		return this.root;
	}

	/**
	 * Starts the verification, unless it is running or done
	 */
	start(): void {
		if (
			!this.destroyed &&
			this.currentState !== "verifying" &&
			this.currentState !== "verified"
		) {
			this.run().catch(() => {
				// Reported through onError and the error state; aborts come from reset() or destroy()
			});
		}
	}

	/**
	 * @returns the solution, once the verification (started if needed) succeeds. Rejects with a KnCaptchaError, or an
	 * AbortError when reset() or destroy() interrupts it.
	 */
	execute(): Promise<string> {
		if (this.destroyed) {
			return Promise.reject(new DOMException("The captcha was destroyed", "AbortError"));
		}
		if (this.currentState === "verified") {
			return Promise.resolve(this.currentSolution);
		}
		return this.run();
	}

	/**
	 * Forgets the solution (the server accepts it once) and goes back to the unchecked box. The automatic modes start
	 * again right away.
	 */
	reset(): void {
		if (this.destroyed) {
			return;
		}
		this.stop();
		this.setSolution("");
		this.setState("idle");
		if (this.restartsByItself()) {
			this.start();
		}
	}

	/**
	 * Changes the texts, icons or classes
	 * @param options
	 */
	setOptions(options: KnCaptchaDisplayOptions): void {
		Object.assign(this.options, options);
		this.icons = {
			...tablerIcons,
			...this.options.icons,
		};
		this.applyClasses();
		this.refreshStrings();
	}

	/**
	 * Stops the work and removes the widget
	 */
	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.stop();
		this.destroyed = true;
		this.stopLocales();
		this.root.removeEventListener("click", this.onClick);
		this.form?.removeEventListener("focusin", this.onFormFocus);
		this.root.remove();
	}

	private readonly onClick = (): void => {
		if (
			this.currentState === "idle" ||
			this.currentState === "expired" ||
			this.currentState === "error"
		) {
			this.start();
		}
	};

	private readonly refreshStrings = (): void => {
		this.strings = resolveStrings(this.options.lang, this.options.strings);
		this.render();
	};

	private readonly onFormFocus = (): void => {
		this.form?.removeEventListener("focusin", this.onFormFocus);
		if (this.currentState === "idle") {
			this.start();
		}
	};

	private restartsByItself(): boolean {
		const start = this.options.start ?? "click";
		return start === "auto" || (start === "focus" && this.activated);
	}

	private run(): Promise<string> {
		if (this.running !== null) {
			return this.running;
		}
		const controller = new AbortController();
		this.controller = controller;
		this.activated = true;
		this.setSolution("");
		this.setProgress(0);
		this.setState("verifying");

		const running = this.solve(controller.signal).then(
			({ solution, challenge, receivedAt }) => {
				if (controller.signal.aborted) {
					throw new DOMException("The verification was aborted", "AbortError");
				}
				this.running = this.controller = null;
				this.setProgress(1);
				this.setSolution(solution);
				this.setState("verified");
				this.scheduleExpiry(challenge, receivedAt);
				this.options.onVerify?.(solution);
				return solution;
			},
			(error: unknown) => {
				if (controller.signal.aborted) {
					throw error;
				}
				this.running = this.controller = null;
				const failure =
					error instanceof KnCaptchaError
						? error
						: new KnCaptchaError("solver", "The proof of work failed", {
								cause: error,
							});
				this.setState("error");
				this.options.onError?.(failure);
				throw failure;
			},
		);
		this.running = running;
		return running;
	}

	private async solve(signal: AbortSignal): Promise<{
		solution: string;
		challenge: Challenge;
		receivedAt: number;
	}> {
		const startedAt = Date.now();
		const token = await this.fetchChallenge(signal);
		const receivedAt = Date.now();
		const challenge = parseChallenge(token);
		const proofs = await this.solver.solve(challenge, this.setProgress, signal);
		const wait = (this.options.minDuration ?? 500) - (Date.now() - startedAt);
		if (wait > 0) {
			await new Promise((resolve) => setTimeout(resolve, wait));
		}
		if (signal.aborted) {
			throw new DOMException("The verification was aborted", "AbortError");
		}
		return {
			solution: encodeSolution(challenge, proofs),
			challenge,
			receivedAt,
		};
	}

	private async fetchChallenge(signal: AbortSignal): Promise<string> {
		const source = this.options.challenge;
		let body: string;
		try {
			if (typeof source === "function") {
				return await source(signal);
			}
			const response = await fetch(source, {
				method: "GET",
				credentials: "same-origin",
				cache: "no-store",
				headers: {
					Accept: "application/json, text/plain",
				},
				...this.options.fetchInit,
				signal,
			});
			if (!response.ok) {
				throw new KnCaptchaError(
					"network",
					`The challenge request answered HTTP ${response.status}`,
				);
			}
			body = await response.text();
		} catch (e) {
			if (e instanceof KnCaptchaError || signal.aborted) {
				throw e;
			}
			throw new KnCaptchaError("network", "The challenge could not be fetched", {
				cause: e,
			});
		}
		return readChallenge(body);
	}

	/**
	 * Expires the solution shortly before the server would refuse it, measured on the local clock from the reception
	 * of the challenge: the clocks of the browser and of the server may differ
	 * @param challenge
	 * @param receivedAt
	 */
	private scheduleExpiry(challenge: Challenge, receivedAt: number): void {
		const lifetime = (challenge.expiresAt - challenge.issuedAt) * 1000;
		const delay = lifetime - Math.min(30_000, lifetime * 0.1) - (Date.now() - receivedAt);
		clearTimeout(this.expiryTimer);
		this.expiryTimer = setTimeout(
			() => {
				this.setSolution("");
				this.setState("expired");
				this.options.onExpire?.();
				if (this.restartsByItself()) {
					this.start();
				}
			},
			Math.max(0, delay),
		);
	}

	private stop(): void {
		clearTimeout(this.expiryTimer);
		this.controller?.abort();
		this.controller = null;
		this.running = null;
	}

	private setState(state: KnCaptchaState): void {
		if (state === this.currentState) {
			return;
		}
		this.currentState = state;
		this.render();
		this.options.onStateChange?.(state);
	}

	private setSolution(solution: string): void {
		this.currentSolution = solution;
		if (this.input !== null) {
			this.input.value = solution;
		}
	}

	private readonly setProgress = (progress: number): void => {
		this.root.style.setProperty("--knc-progress", progress.toFixed(3));
		if (progress > 0 && progress < 1) {
			this.options.onProgress?.(progress);
		}
	};

	private render(): void {
		const state = this.currentState;
		const actionable = state === "idle" || state === "expired" || state === "error";
		this.root.dataset.state = state;
		// Screen readers pronounce the texts in their language, whatever the language of the page
		this.root.lang = resolveLang(this.options.lang);
		this.root.setAttribute("aria-busy", String(state === "verifying"));
		this.box.setAttribute("aria-checked", state === "verified" ? "true" : "false");
		this.box.setAttribute("aria-disabled", String(!actionable));
		this.box.innerHTML = this.icons[STATE_ICONS[state]];
		this.label.textContent = this.strings.label;
		this.status.textContent = state === "idle" ? "" : this.strings[state];
		this.logo.innerHTML = this.icons.logo;
		this.logo.title = this.strings.logo;
		this.logo.hidden = this.icons.logo === "";
	}

	private applyClasses(): void {
		const classes = this.options.classes ?? {};
		const parts: [
			HTMLElement,
			KnCaptchaPart,
		][] = [
			[
				this.root,
				"root",
			],
			[
				this.box,
				"box",
			],
			[
				this.body,
				"body",
			],
			[
				this.label,
				"label",
			],
			[
				this.status,
				"status",
			],
			[
				this.logo,
				"logo",
			],
			[
				this.progressTrack,
				"progress",
			],
			[
				this.bar,
				"bar",
			],
		];
		for (const [element, part] of parts) {
			element.className =
				`${part === "root" ? "knc" : `knc-${part}`} ${classes[part] ?? ""}`.trim();
		}
	}
}

/**
 * @param body answer of the challenge endpoint: `{"challenge": "..."}`, a JSON string, or the challenge as text
 * @returns the challenge
 */
function readChallenge(body: string): string {
	const text = body.trim();
	if (text.startsWith("{") || text.startsWith('"')) {
		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch (e) {
			throw new KnCaptchaError("challenge", "The challenge endpoint answered invalid JSON", {
				cause: e,
			});
		}
		if (typeof data === "string") {
			return data;
		}
		if (
			typeof data === "object" &&
			data !== null &&
			"challenge" in data &&
			typeof data.challenge === "string"
		) {
			return data.challenge;
		}
		throw new KnCaptchaError(
			"challenge",
			'The challenge endpoint answered JSON without a "challenge" string',
		);
	}
	return text;
}
