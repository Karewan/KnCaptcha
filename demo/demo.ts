import { KnCaptcha, type StartMode } from "../src/index";
import "./german";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const theme = $<HTMLSelectElement>("theme");
const lang = $<HTMLSelectElement>("lang");
const start = $<HTMLSelectElement>("start");
const bits = $<HTMLSelectElement>("bits");
const server = $<HTMLSelectElement>("server");
const form = $<HTMLFormElement>("form");
const submit = $<HTMLButtonElement>("submit");
const result = $<HTMLOutputElement>("result");
const log = $<HTMLOListElement>("log");

const endpoints = (): {
	challenge: string;
	verify: string;
} =>
	server.value === "php"
		? {
				challenge: `/php/captcha/challenge?bits=${bits.value}`,
				verify: "/php/login",
			}
		: {
				challenge: `/api/challenge?bits=${bits.value}`,
				verify: "/api/verify",
			};

function write(message: string): void {
	const item = document.createElement("li");
	item.textContent = `${new Date().toLocaleTimeString()} ${message}`;
	log.prepend(item);
}

let captcha: KnCaptcha | null = null;
let startedAt = 0;

function mount(): void {
	captcha?.destroy();
	result.textContent = "";
	captcha = new KnCaptcha("#captcha", {
		challenge: endpoints().challenge,
		start: start.value as StartMode,
		lang: lang.value,
		onStateChange: (state) => {
			if (state === "verifying") {
				startedAt = performance.now();
			}
			submit.disabled = state !== "verified";
			write(`state: ${state}`);
		},
		onVerify: (solution) =>
			write(
				`verified in ${Math.round(performance.now() - startedAt)} ms, ${solution.length} characters`,
			),
		onExpire: () => write("expired"),
		onError: (error) => write(`error ${error.code}: ${error.message}`),
	});
	submit.disabled = true;
}

form.addEventListener("submit", (event) => {
	event.preventDefault();
	void fetch(endpoints().verify, {
		method: "POST",
		body: new URLSearchParams(new FormData(form) as unknown as Record<string, string>),
	})
		.then(
			(response) =>
				response.json() as Promise<{
					result: string;
				}>,
		)
		.then(({ result: verdict }) => {
			result.textContent = `Server: ${verdict}`;
			write(`server: ${verdict}`);
			// A solution passes once: a new one for the next submission
			captcha?.reset();
		});
});

$("reset").addEventListener("click", () => captcha?.reset());
theme.addEventListener("change", () =>
	document.documentElement.classList.toggle("dark", theme.value === "dark"),
);
// The language changes on the displayed widget, without losing its state
lang.addEventListener("change", () =>
	captcha?.setOptions({
		lang: lang.value,
	}),
);
for (const select of [
	start,
	bits,
	server,
]) {
	select.addEventListener("change", mount);
}
mount();

// Second widget: other Tabler icons (circle, circle-check filled, loader-3), texts, variables and classes
const custom = $("custom");
custom.classList.add("brand");
new KnCaptcha(custom, {
	challenge: "/api/challenge?bits=3",
	name: null,
	lang: "en",
	strings: {
		label: "Prove you are human",
		verified: "Welcome, human!",
	},
	classes: {
		label: "is-strong",
	},
	icons: {
		checkbox:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0"/></svg>',
		checked:
			'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-1.293 5.953a1 1 0 0 0 -1.32 -.083l-.094 .083l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.403 1.403l.083 .094l2 2l.094 .083a1 1 0 0 0 1.226 0l.094 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z"/></svg>',
		spinner:
			'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 0 9 9a9 9 0 0 0 9 -9a9 9 0 0 0 -9 -9"/><path d="M17 12a5 5 0 1 0 -5 5"/></svg>',
		logo: "",
	},
});
