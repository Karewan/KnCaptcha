export { type Challenge, encodeSolution, parseChallenge } from "./challenge";
export { KnCaptchaError, type KnCaptchaErrorCode } from "./errors";
export { type KnCaptchaIcons, tablerIcons } from "./icons";
export { DEFAULT_LANG, type KnCaptchaStrings, locales, registerLocale } from "./locales";
export type { Solver } from "./solver/pool";
export {
	type ChallengeSource,
	KnCaptcha,
	type KnCaptchaDisplayOptions,
	type KnCaptchaOptions,
	type KnCaptchaPart,
	type KnCaptchaState,
	type StartMode,
	VERSION,
} from "./widget";
