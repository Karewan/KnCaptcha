import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, reactive, ref } from "vue";
import { KnCaptcha, type KnCaptchaStrings, registerLocale } from "../src/vue";
import { defined } from "./support/defined";
import { FakeSolver } from "./support/fakes";
import { issueChallenge } from "./support/server";

const challenge = async (): Promise<string> =>
	issueChallenge("vue-secret-vue-secret-vue-secret-vue");

const mounted: {
	unmount(): void;
}[] = [];
afterEach(() => {
	for (const wrapper of mounted.splice(0)) {
		wrapper.unmount();
	}
});

function mountCaptcha(props: Record<string, unknown> = {}) {
	const wrapper = mount(KnCaptcha, {
		props: {
			challenge,
			solver: new FakeSolver(),
			lang: "fr",
			minDuration: 0,
			...props,
		},
		attachTo: document.body,
	});
	mounted.push(wrapper);
	return wrapper;
}

describe("KnCaptcha Vue component", () => {
	it("renders the widget inside its host element", () => {
		const wrapper = mountCaptcha();
		expect(wrapper.classes()).toContain("knc-host");
		expect(wrapper.find(".knc").attributes("data-state")).toBe("idle");
		expect(wrapper.find(".knc-label").text()).toBe("Je ne suis pas un robot");
		expect(wrapper.find('input[name="kncaptcha"]').exists()).toBe(true);
	});

	it("emits the solution through v-model and the events", async () => {
		const wrapper = mountCaptcha();
		await wrapper.find(".knc-box").trigger("click");
		await vi.waitFor(() => expect(wrapper.emitted("verify")).toHaveLength(1));

		const solution = defined(
			wrapper.emitted<
				[
					string,
				]
			>("verify"),
		)[0][0];
		expect(solution.split(".")).toHaveLength(3);
		expect(
			wrapper
				.emitted<
					[
						string,
					]
				>("update:modelValue")
				?.at(-1),
		).toEqual([
			solution,
		]);
		expect(
			wrapper
				.emitted<
					[
						string,
					]
				>("stateChange")
				?.map(([state]) => state),
		).toEqual([
			"verifying",
			"verified",
		]);
	});

	it("resets when the parent clears the solution", async () => {
		const Parent = defineComponent({
			setup() {
				const solution = ref("");
				return () =>
					h("div", [
						h(KnCaptcha, {
							challenge,
							solver: new FakeSolver(),
							minDuration: 0,
							modelValue: solution.value,
							"onUpdate:modelValue": (value: string) => (solution.value = value),
						}),
						h("button", {
							id: "clear",
							onClick: () => (solution.value = ""),
						}),
						h("output", solution.value),
					]);
			},
		});
		const wrapper = mount(Parent, {
			attachTo: document.body,
		});
		mounted.push(wrapper);

		await wrapper.find(".knc-box").trigger("click");
		await vi.waitFor(() => expect(wrapper.find("output").text()).not.toBe(""));
		expect(wrapper.find(".knc").attributes("data-state")).toBe("verified");

		await wrapper.find("#clear").trigger("click");
		await nextTick();
		expect(wrapper.find(".knc").attributes("data-state")).toBe("idle");
	});

	it("exposes start(), reset() and execute()", async () => {
		const wrapper = mountCaptcha();
		const exposed = wrapper.vm as unknown as {
			start(): void;
			reset(): void;
			execute(): Promise<string>;
		};
		const solution = await exposed.execute();
		expect(solution).not.toBe("");
		exposed.reset();
		await nextTick();
		expect(wrapper.find(".knc").attributes("data-state")).toBe("idle");
		exposed.start();
		await vi.waitFor(() =>
			expect(wrapper.find(".knc").attributes("data-state")).toBe("verified"),
		);
	});

	it("follows the changes of lang, strings and classes", async () => {
		const wrapper = mountCaptcha();
		await wrapper.setProps({
			lang: "en",
			classes: {
				root: "shadow",
			},
		});
		expect(wrapper.find(".knc-label").text()).toBe("I'm not a robot");
		expect(wrapper.find(".knc").classes()).toContain("shadow");
		await wrapper.setProps({
			strings: {
				label: "Human?",
			},
		});
		expect(wrapper.find(".knc-label").text()).toBe("Human?");
	});

	it("switches language with its parent, texts of the current state included", async () => {
		const Parent = defineComponent({
			setup() {
				const lang = ref("fr");
				return () =>
					h("div", [
						h(KnCaptcha, {
							challenge,
							solver: new FakeSolver(),
							minDuration: 0,
							lang: lang.value,
						}),
						h("button", {
							id: "english",
							onClick: () => {
								lang.value = "en";
							},
						}),
						h("button", {
							id: "default",
							onClick: () => {
								lang.value = "fr";
							},
						}),
					]);
			},
		});
		const wrapper = mount(Parent, {
			attachTo: document.body,
		});
		mounted.push(wrapper);

		await wrapper.find(".knc-box").trigger("click");
		await vi.waitFor(() =>
			expect(wrapper.find(".knc-status").text()).toBe("Vérification réussie"),
		);
		await wrapper.find("#english").trigger("click");
		expect(wrapper.find(".knc-label").text()).toBe("I'm not a robot");
		expect(wrapper.find(".knc-status").text()).toBe("Verified");
		expect(wrapper.find(".knc").attributes("lang")).toBe("en");
		expect(wrapper.find(".knc").attributes("data-state")).toBe("verified");
		await wrapper.find("#default").trigger("click");
		expect(wrapper.find(".knc-label").text()).toBe("Je ne suis pas un robot");
	});

	it("speaks English when the lang prop goes away", async () => {
		const wrapper = mountCaptcha();
		expect(wrapper.find(".knc-label").text()).toBe("Je ne suis pas un robot");
		await wrapper.setProps({
			lang: undefined,
		});
		expect(wrapper.find(".knc-label").text()).toBe("I'm not a robot");
	});

	it("follows a reactive strings object changed in place", async () => {
		const strings = reactive<Partial<KnCaptchaStrings>>({
			label: "Humain ?",
		});
		const wrapper = mountCaptcha({
			strings,
		});
		expect(wrapper.find(".knc-label").text()).toBe("Humain ?");
		strings.label = "Toujours humain ?";
		await nextTick();
		expect(wrapper.find(".knc-label").text()).toBe("Toujours humain ?");
	});

	it("shows a language registered after it was mounted", () => {
		const wrapper = mountCaptcha({
			lang: "it",
		});
		expect(wrapper.find(".knc-label").text()).toBe("I'm not a robot");
		registerLocale("it", {
			label: "Non sono un robot",
			verifying: "Verifica in corso…",
			verified: "Verificato",
			expired: "Verifica scaduta, seleziona di nuovo la casella",
			error: "Verifica non riuscita, clicca per riprovare",
			logo: "Protetto da KnCaptcha, senza cookie né tracciamento",
		});
		expect(wrapper.find(".knc-label").text()).toBe("Non sono un robot");
	});

	it("passes the input name, or none", () => {
		expect(
			mountCaptcha({
				name: "captcha",
			})
				.find('input[name="captcha"]')
				.exists(),
		).toBe(true);
		expect(
			mountCaptcha({
				name: null,
			})
				.find("input")
				.exists(),
		).toBe(false);
	});

	it("reports errors", async () => {
		const wrapper = mountCaptcha({
			challenge: () => Promise.reject(new Error("offline")),
		});
		await wrapper.find(".knc-box").trigger("click");
		await vi.waitFor(() => expect(wrapper.emitted("error")).toHaveLength(1));
		expect(wrapper.find(".knc").attributes("data-state")).toBe("error");
	});

	it("removes the widget when unmounted", () => {
		const wrapper = mountCaptcha();
		mounted.pop();
		wrapper.unmount();
		expect(document.querySelector(".knc")).toBeNull();
	});
});
