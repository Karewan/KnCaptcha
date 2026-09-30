import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KnCaptchaError } from "../src/errors";
import { type KnCaptchaStrings, registerLocale } from "../src/locales";
import { KnCaptcha, type KnCaptchaOptions, type KnCaptchaState } from "../src/widget";
import { query } from "./support/defined";
import { FakeSolver } from "./support/fakes";
import { issueChallenge } from "./support/server";

const SECRET = "widget-secret-widget-secret-widget";

const GERMAN: KnCaptchaStrings = {
	label: "Ich bin kein Roboter",
	verifying: "Überprüfung läuft…",
	verified: "Überprüft",
	expired: "Überprüfung abgelaufen, bitte erneut ankreuzen",
	error: "Überprüfung fehlgeschlagen, zum Wiederholen klicken",
	logo: "Geschützt durch KnCaptcha, ohne Cookies und Tracking",
};

let container: HTMLElement;
let widgets: KnCaptcha[] = [];

function create(
	options: Partial<KnCaptchaOptions> = {},
	target: HTMLElement = container,
): KnCaptcha {
	const widget = new KnCaptcha(target, {
		challenge: async () =>
			issueChallenge(SECRET, {
				ttl: 100,
			}),
		solver: new FakeSolver(),
		lang: "fr",
		minDuration: 0,
		...options,
	});
	widgets.push(widget);
	return widget;
}

const box = (widget: KnCaptcha): HTMLButtonElement => query(".knc-box", widget.element);
// innerHTML serializes <path/> as <path></path>
const html = (markup: string): string => {
	const element = document.createElement("div");
	element.innerHTML = markup;
	return element.innerHTML;
};
const text = (widget: KnCaptcha, part: string): string =>
	query(`.knc-${part}`, widget.element).textContent ?? "";

async function until(widget: KnCaptcha, state: KnCaptchaState): Promise<void> {
	await vi.waitFor(() => expect(widget.state).toBe(state));
}

beforeEach(() => {
	document.body.innerHTML = '<form id="form"><input id="login"><div id="captcha"></div></form>';
	container = query("#captcha");
});

afterEach(() => {
	for (const widget of widgets) {
		widget.destroy();
	}
	widgets = [];
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("rendering", () => {
	it("shows an unchecked, labelled box", () => {
		const widget = create();
		const root = query(".knc", container);
		expect(root.getAttribute("data-state")).toBe("idle");
		expect(box(widget).getAttribute("role")).toBe("checkbox");
		expect(box(widget).getAttribute("aria-checked")).toBe("false");
		expect(box(widget).type).toBe("button");
		expect(text(widget, "label")).toBe("Je ne suis pas un robot");
		expect(text(widget, "status")).toBe("");
		const labelId = box(widget).getAttribute("aria-labelledby") ?? "";
		expect(document.getElementById(labelId)?.textContent).toBe("Je ne suis pas un robot");
		expect(box(widget).innerHTML).toBe(html(KnCaptcha.icons.checkbox));
		expect(query(".knc-logo", widget.element).getAttribute("title")).toContain("KnCaptcha");
	});

	it("adds a hidden input to the form", () => {
		create();
		const input = query<HTMLInputElement>('input[name="kncaptcha"]');
		expect(input.type).toBe("hidden");
		expect(input.value).toBe("");
	});

	it("takes another input name, or none", () => {
		create({
			name: "captcha_solution",
		});
		expect(document.querySelector('input[name="captcha_solution"]')).not.toBeNull();
		document.body.innerHTML = '<div id="other"></div>';
		create(
			{
				name: null,
			},
			query("#other"),
		);
		expect(document.querySelector("#other input")).toBeNull();
	});

	it("accepts a selector and refuses one that matches nothing", () => {
		create({}, "#captcha" as unknown as HTMLElement);
		expect(container.querySelectorAll(".knc")).toHaveLength(1);
		expect(() => create({}, "#missing" as unknown as HTMLElement)).toThrow(TypeError);
	});

	it("adds the classes of each part", () => {
		const widget = create({
			classes: {
				root: "rounded-xl shadow",
				label: "font-bold",
			},
		});
		expect(widget.element.className).toBe("knc rounded-xl shadow");
		expect(query(".knc-label", widget.element).className).toBe("knc-label font-bold");
	});

	it("replaces icons and texts", () => {
		const widget = create({
			icons: {
				checkbox: '<svg id="custom"></svg>',
				logo: "",
			},
			strings: {
				label: "Humain ?",
			},
		});
		expect(box(widget).innerHTML).toBe('<svg id="custom"></svg>');
		expect(query(".knc-logo", widget.element).hidden).toBe(true);
		expect(text(widget, "label")).toBe("Humain ?");
	});

	it("speaks English by default, whatever the language of the page", () => {
		document.documentElement.lang = "fr";
		const widget = create({
			lang: undefined,
		});
		expect(text(widget, "label")).toBe("I'm not a robot");
		expect(widget.element.lang).toBe("en");
		document.documentElement.lang = "";
	});

	it("falls back on the base language, then on English", () => {
		const regional = create({
			lang: "fr-CA",
		});
		expect(text(regional, "label")).toBe("Je ne suis pas un robot");
		expect(regional.element.lang).toBe("fr");
		const unknown = create({
			lang: "xx",
		});
		expect(text(unknown, "label")).toBe("I'm not a robot");
		expect(unknown.element.lang).toBe("en");
	});

	it("uses a registered language, even registered after it was displayed", () => {
		const widget = create({
			lang: "de",
		});
		expect(text(widget, "label")).toBe("I'm not a robot");
		registerLocale("de", GERMAN);
		expect(text(widget, "label")).toBe("Ich bin kein Roboter");
		expect(widget.element.lang).toBe("de");
		expect(KnCaptcha.locales.de?.label).toBe("Ich bin kein Roboter");
	});

	it("prefers a registered regional variant", () => {
		registerLocale("FR-be", {
			...KnCaptcha.locales.fr,
			label: "Je ne suis pas un robot, une fois",
		} as KnCaptchaStrings);
		expect(
			text(
				create({
					lang: "fr-BE",
				}),
				"label",
			),
		).toBe("Je ne suis pas un robot, une fois");
		expect(
			text(
				create({
					lang: "fr-CH",
				}),
				"label",
			),
		).toBe("Je ne suis pas un robot");
	});

	it("completes a partial locale with English", () => {
		KnCaptcha.registerLocale("pt", {
			label: "Não sou um robô",
		} as KnCaptchaStrings);
		const widget = create({
			lang: "pt",
		});
		widget.start();
		expect(text(widget, "label")).toBe("Não sou um robô");
		expect(text(widget, "status")).toBe("Verifying…");
	});

	it("refuses a locale without tag", () => {
		expect(() => registerLocale(" ", GERMAN)).toThrow(TypeError);
	});

	it("ignores the undefined texts", () => {
		const widget = create({
			strings: {
				label: undefined,
				verifying: "Un instant…",
			} as unknown as Partial<KnCaptchaStrings>,
		});
		widget.start();
		expect(text(widget, "label")).toBe("Je ne suis pas un robot");
		expect(text(widget, "status")).toBe("Un instant…");
	});

	it("stops following the registered languages once destroyed", () => {
		const widget = create({
			lang: "nl",
		});
		widget.destroy();
		registerLocale("nl", {
			...GERMAN,
			label: "Ik ben geen robot",
		});
		expect(text(widget, "label")).toBe("I'm not a robot");
	});

	it("changes texts, icons and classes afterwards", () => {
		const widget = create();
		widget.setOptions({
			lang: "en",
			classes: {
				root: "extra",
			},
		});
		expect(text(widget, "label")).toBe("I'm not a robot");
		expect(widget.element.className).toBe("knc extra");
	});
});

describe("verification", () => {
	it("checks the box on click", async () => {
		const states: KnCaptchaState[] = [];
		const onVerify = vi.fn();
		const progress: number[] = [];
		const widget = create({
			onStateChange: (s) => states.push(s),
			onVerify,
			onProgress: (p) => progress.push(p),
		});

		box(widget).click();
		expect(widget.state).toBe("verifying");
		expect(text(widget, "status")).toBe("Vérification en cours…");
		expect(widget.element.getAttribute("aria-busy")).toBe("true");
		await until(widget, "verified");

		expect(states).toEqual([
			"verifying",
			"verified",
		]);
		expect(onVerify).toHaveBeenCalledWith(widget.solution);
		expect(widget.solution.split(".")).toHaveLength(3);
		expect(query<HTMLInputElement>('input[name="kncaptcha"]').value).toBe(widget.solution);
		expect(box(widget).getAttribute("aria-checked")).toBe("true");
		expect(box(widget).getAttribute("aria-disabled")).toBe("true");
		expect(box(widget).innerHTML).toBe(html(KnCaptcha.icons.checked));
		expect(text(widget, "status")).toBe("Vérification réussie");
		expect(progress).toEqual([
			0.5,
		]);
		expect(widget.element.style.getPropertyValue("--knc-progress")).toBe("1.000");
	});

	it("starts from a click anywhere on the widget, once", async () => {
		const solver = new FakeSolver();
		const widget = create({
			solver,
		});
		query(".knc-label", widget.element).click();
		widget.element.click();
		await until(widget, "verified");
		widget.element.click();
		expect(solver.calls).toBe(1);
	});

	it("gives the solution through execute()", async () => {
		const solver = new FakeSolver();
		const widget = create({
			solver,
		});
		const solution = await widget.execute();
		expect(solution).toBe(widget.solution);
		expect(await widget.execute()).toBe(solution);
		expect(solver.calls).toBe(1);
	});

	it("waits for the minimum duration", async () => {
		vi.useFakeTimers();
		const widget = create({
			minDuration: 800,
		});
		widget.start();
		await vi.advanceTimersByTimeAsync(700);
		expect(widget.state).toBe("verifying");
		await vi.advanceTimersByTimeAsync(200);
		expect(widget.state).toBe("verified");
	});

	it("fetches the challenge from a URL, JSON or plain text", async () => {
		const token = issueChallenge(SECRET);
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						challenge: token,
					}),
				),
			)
			.mockResolvedValueOnce(new Response(token));
		vi.stubGlobal("fetch", fetchMock);

		const widget = create({
			challenge: "/captcha/challenge",
			fetchInit: {
				headers: {
					"X-CSRF": "abc",
				},
			},
		});
		expect((await widget.execute()).startsWith(`${token}.`)).toBe(true);
		const [url, init] = fetchMock.mock.calls[0] as [
			string,
			RequestInit,
		];
		expect(url).toBe("/captcha/challenge");
		expect(init).toMatchObject({
			method: "GET",
			cache: "no-store",
			credentials: "same-origin",
			headers: {
				"X-CSRF": "abc",
			},
		});
		expect(init.signal).toBeInstanceOf(AbortSignal);

		widget.reset();
		expect((await widget.execute()).startsWith(`${token}.`)).toBe(true);
	});
});

describe("errors", () => {
	const failure = async (options: Partial<KnCaptchaOptions>): Promise<KnCaptchaError> => {
		const onError = vi.fn();
		const widget = create({
			...options,
			onError,
		});
		await expect(widget.execute()).rejects.toBeInstanceOf(KnCaptchaError);
		expect(widget.state).toBe("error");
		expect(onError).toHaveBeenCalledOnce();
		return onError.mock.calls[0][0] as KnCaptchaError;
	};

	it("reports a failed challenge function as a network error", async () => {
		const error = await failure({
			challenge: () => Promise.reject(new Error("offline")),
		});
		expect(error.code).toBe("network");
		expect((error.cause as Error).message).toBe("offline");
	});

	it("reports an HTTP error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response("nope", {
					status: 503,
				}),
			),
		);
		expect(
			(
				await failure({
					challenge: "/challenge",
				})
			).code,
		).toBe("network");
	});

	it("reports a failed fetch", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
		expect(
			(
				await failure({
					challenge: "/challenge",
				})
			).code,
		).toBe("network");
	});

	it("reports JSON without a challenge", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"error": "no"}')));
		expect(
			(
				await failure({
					challenge: "/challenge",
				})
			).code,
		).toBe("challenge");
	});

	it("reports a malformed challenge", async () => {
		expect(
			(
				await failure({
					challenge: async () => "not-a-challenge",
				})
			).code,
		).toBe("challenge");
	});

	it("reports a solver failure", async () => {
		const solver = new FakeSolver();
		solver.failWith = new Error("out of memory");
		expect(
			(
				await failure({
					solver,
				})
			).code,
		).toBe("solver");
	});

	it("retries on click", async () => {
		let calls = 0;
		const widget = create({
			challenge: async () => {
				if (++calls === 1) {
					throw new Error("offline");
				}
				return issueChallenge(SECRET);
			},
		});
		widget.start();
		await until(widget, "error");
		expect(text(widget, "status")).toBe("La vérification a échoué, cliquez pour réessayer");
		expect(box(widget).getAttribute("aria-disabled")).toBe("false");
		box(widget).click();
		await until(widget, "verified");
	});
});

describe("expiry and reset", () => {
	it("expires shortly before the server would refuse the solution", async () => {
		vi.useFakeTimers();
		const onExpire = vi.fn();
		const widget = create({
			onExpire,
		});
		widget.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(widget.state).toBe("verified");

		// 100 s challenge: expired locally after 90 s
		await vi.advanceTimersByTimeAsync(89_000);
		expect(widget.state).toBe("verified");
		await vi.advanceTimersByTimeAsync(1_000);
		expect(widget.state).toBe("expired");
		expect(widget.solution).toBe("");
		expect(query<HTMLInputElement>('input[name="kncaptcha"]').value).toBe("");
		expect(onExpire).toHaveBeenCalledOnce();
		expect(box(widget).innerHTML).toBe(html(KnCaptcha.icons.expired));
	});

	it("starts again by itself after an expiry in auto mode", async () => {
		vi.useFakeTimers();
		const solver = new FakeSolver();
		const widget = create({
			start: "auto",
			solver,
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(widget.state).toBe("verified");
		await vi.advanceTimersByTimeAsync(90_000);
		expect(solver.calls).toBe(2);
		expect(widget.state).toBe("verified");
	});

	it("forgets the solution on reset", async () => {
		const widget = create();
		await widget.execute();
		widget.reset();
		expect(widget.state).toBe("idle");
		expect(widget.solution).toBe("");
		expect(box(widget).getAttribute("aria-checked")).toBe("false");
	});

	it("aborts a running verification on reset, without error", async () => {
		const solver = new FakeSolver(true);
		const onError = vi.fn();
		const widget = create({
			solver,
			onError,
		});
		const running = widget.execute();
		await vi.waitFor(() => expect(solver.calls).toBe(1));
		widget.reset();
		await expect(running).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(solver.lastSignal?.aborted).toBe(true);
		expect(widget.state).toBe("idle");
		expect(onError).not.toHaveBeenCalled();
	});

	it("starts again on reset in auto mode", async () => {
		const solver = new FakeSolver();
		const widget = create({
			start: "auto",
			solver,
		});
		await until(widget, "verified");
		widget.reset();
		await until(widget, "verified");
		expect(solver.calls).toBe(2);
	});
});

describe("start modes", () => {
	it("auto: starts right away", async () => {
		await until(
			create({
				start: "auto",
			}),
			"verified",
		);
	});

	it("focus: starts when the form gets the focus, then restarts by itself", async () => {
		const solver = new FakeSolver();
		const widget = create({
			start: "focus",
			solver,
		});
		expect(widget.state).toBe("idle");
		widget.reset();
		expect(solver.calls).toBe(0);

		query("#login").dispatchEvent(
			new FocusEvent("focusin", {
				bubbles: true,
			}),
		);
		await until(widget, "verified");
		widget.reset();
		await vi.waitFor(() => expect(solver.calls).toBe(2));
	});

	it("focus: can still be clicked", async () => {
		const widget = create({
			start: "focus",
		});
		box(widget).click();
		await until(widget, "verified");
	});
});

describe("destroy", () => {
	it("removes the widget and stops the work", async () => {
		const solver = new FakeSolver(true);
		const widget = create({
			solver,
		});
		const running = widget.execute();
		await vi.waitFor(() => expect(solver.calls).toBe(1));
		widget.destroy();
		await expect(running).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(container.querySelector(".knc")).toBeNull();
		widget.start();
		widget.reset();
		await expect(widget.execute()).rejects.toMatchObject({
			name: "AbortError",
		});
		expect(solver.calls).toBe(1);
	});
});
