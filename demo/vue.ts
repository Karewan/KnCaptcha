import { createApp, defineComponent, h, ref } from "vue";
import { KnCaptcha } from "../src/vue";
import "./german";

const App = defineComponent({
	setup() {
		const solution = ref("");
		const dark = ref(false);
		const lang = ref("en");
		const verdict = ref("");
		const events = ref<string[]>([]);
		const push = (event: string): void => {
			events.value = [
				`${new Date().toLocaleTimeString()} ${event}`,
				...events.value,
			].slice(0, 20);
		};

		const submit = async (): Promise<void> => {
			const response = await fetch("/api/verify", {
				method: "POST",
				body: new URLSearchParams({
					kncaptcha: solution.value,
				}),
			});
			verdict.value = (
				(await response.json()) as {
					result: string;
				}
			).result;
			// Clearing v-model resets the widget: a solution passes once
			solution.value = "";
		};

		return () =>
			h("main", [
				h("header", [
					h("h1", [
						"KnCaptcha ",
						h("small", "Vue 3"),
					]),
					h("nav", [
						h(
							"a",
							{
								href: "./index.html",
							},
							"Vanilla demo",
						),
					]),
				]),
				h(
					"fieldset",
					{
						class: "controls",
					},
					[
						h("label", [
							"Theme",
							h(
								"select",
								{
									value: dark.value ? "dark" : "light",
									onChange: (e: Event) => {
										dark.value =
											(e.target as HTMLSelectElement).value === "dark";
										document.documentElement.classList.toggle(
											"dark",
											dark.value,
										);
									},
								},
								[
									h(
										"option",
										{
											value: "light",
										},
										"Light",
									),
									h(
										"option",
										{
											value: "dark",
										},
										"Dark",
									),
								],
							),
						]),
						h("label", [
							"Language",
							h(
								"select",
								{
									value: lang.value,
									onChange: (e: Event) =>
										(lang.value = (e.target as HTMLSelectElement).value),
								},
								[
									"en",
									"fr",
									"de",
								].map((code) =>
									h(
										"option",
										{
											value: code,
										},
										code,
									),
								),
							),
						]),
					],
				),
				h(
					"section",
					{
						class: "card",
					},
					[
						h(KnCaptcha, {
							challenge: "/api/challenge",
							lang: lang.value,
							modelValue: solution.value,
							"onUpdate:modelValue": (value: string) => (solution.value = value),
							onStateChange: (state: string) => push(`state-change: ${state}`),
							onVerify: () => push("verify"),
							onError: (error: Error) => push(`error: ${error.message}`),
						}),
						h(
							"div",
							{
								class: "actions",
							},
							[
								h(
									"button",
									{
										disabled: solution.value === "",
										onClick: submit,
									},
									"Submit",
								),
							],
						),
						h(
							"output",
							`v-model: ${solution.value === "" ? "(empty)" : `${solution.value.slice(0, 48)}…`}`,
						),
						verdict.value === "" ? null : h("output", `Server: ${verdict.value}`),
					],
				),
				h(
					"section",
					{
						class: "card",
					},
					[
						h("h2", "Events"),
						h(
							"ol",
							{
								id: "log",
							},
							events.value.map((event) => h("li", event)),
						),
					],
				),
			]);
	},
});

createApp(App).mount("#app");
