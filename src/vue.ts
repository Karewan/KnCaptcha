import { defineComponent, h, onBeforeUnmount, onMounted, type PropType, ref, watch } from "vue";
import type { KnCaptchaError } from "./errors";
import type { KnCaptchaIcons } from "./icons";
import type { KnCaptchaStrings } from "./locales";
import type { Solver } from "./solver/pool";
import {
	type ChallengeSource,
	type KnCaptchaOptions,
	type KnCaptchaPart,
	type KnCaptchaState,
	KnCaptcha as KnCaptchaWidget,
	type StartMode,
} from "./widget";

/**
 * Vue 3 component around the widget
 *
 *     <KnCaptcha v-model="solution" challenge="/captcha/challenge" @verify="..." />
 *
 * v-model holds the solution, empty until verified. Clearing it resets the widget. Exposed methods: start(),
 * reset(), execute().
 */
export const KnCaptcha = defineComponent({
	name: "KnCaptcha",
	// Every optional prop also takes undefined: `:lang="locale"` with a `string | undefined` locale type-checks under
	// exactOptionalPropertyTypes
	props: {
		modelValue: {
			type: String,
			default: "",
		},
		challenge: {
			type: [
				String,
				Object,
				Function,
			] as PropType<ChallengeSource>,
			required: true,
		},
		fetchInit: {
			type: Object as PropType<RequestInit | undefined>,
			default: undefined,
		},
		start: {
			type: String as PropType<StartMode | undefined>,
			default: undefined,
		},
		name: {
			type: [
				String,
				null,
			] as PropType<string | null | undefined>,
			default: undefined,
		},
		lang: {
			type: String as PropType<string | undefined>,
			default: undefined,
		},
		strings: {
			type: Object as PropType<Partial<KnCaptchaStrings> | undefined>,
			default: undefined,
		},
		icons: {
			type: Object as PropType<Partial<KnCaptchaIcons> | undefined>,
			default: undefined,
		},
		classes: {
			type: Object as PropType<Partial<Record<KnCaptchaPart, string>> | undefined>,
			default: undefined,
		},
		workers: {
			type: Number as PropType<number | undefined>,
			default: undefined,
		},
		workerUrl: {
			type: [
				String,
				Object,
			] as PropType<string | URL | undefined>,
			default: undefined,
		},
		minDuration: {
			type: Number as PropType<number | undefined>,
			default: undefined,
		},
		solver: {
			type: Object as PropType<Solver | undefined>,
			default: undefined,
		},
	},
	emits: {
		"update:modelValue": (solution: string) => typeof solution === "string",
		verify: (solution: string) => typeof solution === "string",
		expire: () => true,
		error: (error: KnCaptchaError) => error instanceof Error,
		stateChange: (state: KnCaptchaState) => typeof state === "string",
		progress: (progress: number) => typeof progress === "number",
	},
	setup(props, { emit, expose }) {
		const host = ref<HTMLElement | null>(null);
		let widget: KnCaptchaWidget | null = null;

		const setModel = (solution: string): void => {
			if (props.modelValue !== solution) {
				emit("update:modelValue", solution);
			}
		};

		onMounted(() => {
			if (host.value === null) {
				return;
			}
			const options: KnCaptchaOptions = {
				challenge: props.challenge,
				fetchInit: props.fetchInit,
				start: props.start,
				lang: props.lang,
				strings: props.strings,
				icons: props.icons,
				classes: props.classes,
				workers: props.workers,
				workerUrl: props.workerUrl,
				minDuration: props.minDuration,
				solver: props.solver,
				onStateChange: (state) => {
					if (state !== "verified") {
						setModel("");
					}
					emit("stateChange", state);
				},
				onVerify: (solution) => {
					setModel(solution);
					emit("verify", solution);
				},
				onExpire: () => emit("expire"),
				onError: (error) => emit("error", error),
				onProgress: (progress) => emit("progress", progress),
			};
			// The prop defaults to undefined: the widget then uses its own default name
			if (props.name !== undefined) {
				options.name = props.name;
			}
			widget = new KnCaptchaWidget(host.value, options);
		});

		onBeforeUnmount(() => {
			widget?.destroy();
			widget = null;
		});

		watch(
			() =>
				[
					props.lang,
					props.strings,
					props.icons,
					props.classes,
				] as const,
			([lang, strings, icons, classes]) =>
				widget?.setOptions({
					lang,
					strings,
					icons,
					classes,
				}),
			{
				deep: true,
			},
		);

		// The parent clears the solution (e.g. after the server used it): a new one is needed
		watch(
			() => props.modelValue,
			(solution) => {
				if (solution === "" && widget?.state === "verified") {
					widget.reset();
				}
			},
		);

		expose({
			start: (): void => widget?.start(),
			reset: (): void => widget?.reset(),
			execute: (): Promise<string> =>
				widget?.execute() ??
				Promise.reject(new DOMException("The captcha is not mounted", "InvalidStateError")),
		});

		return () =>
			h("div", {
				ref: host,
				class: "knc-host",
			});
	},
});

/** Languages are shared with the vanilla widget: registering one here also serves the components already mounted */
export { type KnCaptchaStrings, registerLocale } from "./locales";

export default KnCaptcha;
