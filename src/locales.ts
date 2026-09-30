export interface KnCaptchaStrings {
	/** Label of the checkbox */
	label: string;
	verifying: string;
	verified: string;
	expired: string;
	error: string;
	/** Tooltip of the logo */
	logo: string;
}

/** Language used when none is given, and for the texts a locale lacks */
export const DEFAULT_LANG = "en";

const registry: Record<string, Readonly<KnCaptchaStrings>> = {
	en: {
		label: "I'm not a robot",
		verifying: "Verifying…",
		verified: "Verified",
		expired: "Verification expired, check the box again",
		error: "Verification failed, click to try again",
		logo: "Protected by KnCaptcha, without cookies or tracking",
	},
	fr: {
		label: "Je ne suis pas un robot",
		verifying: "Vérification en cours…",
		verified: "Vérification réussie",
		expired: "Vérification expirée, cochez à nouveau la case",
		error: "La vérification a échoué, cliquez pour réessayer",
		logo: "Protégé par KnCaptcha, sans cookie ni pistage",
	},
};

/** Built-in (en, fr) and registered locales, by lowercase language tag */
export const locales: Readonly<Record<string, Readonly<KnCaptchaStrings>>> = registry;

const listeners = new Set<() => void>();

/**
 * Adds or replaces a language for every widget, including those already displayed
 *
 *     registerLocale("de", { label: "Ich bin kein Roboter", ... });
 *
 * @param lang language tag: "de", or "fr-ca" for a regional variant (the widgets asking "fr-CA" get it, the others
 * asking "fr-..." keep "fr")
 * @param strings every text of the widget: a missing one shows in English
 * @throws TypeError when the tag is empty
 */
export function registerLocale(lang: string, strings: KnCaptchaStrings): void {
	const tag = lang.trim().toLowerCase();
	if (tag === "") {
		throw new TypeError("KnCaptcha: a locale needs a language tag");
	}
	registry[tag] = Object.freeze({
		...strings,
	});
	for (const listener of listeners) {
		listener();
	}
}

/**
 * @param listener called after each registerLocale()
 * @returns stops the calls
 * @internal
 */
export function onLocalesChange(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * @param lang language tag ("fr", "fr-CA"...), English when none is given
 * @returns the registered locale that serves it: itself, its base language ("fr" for "fr-CA"), else English
 */
export function resolveLang(lang?: string): string {
	const wanted = (lang ?? DEFAULT_LANG).trim().toLowerCase();
	const base = wanted.split("-")[0];
	if (wanted in registry) {
		return wanted;
	}
	return base in registry ? base : DEFAULT_LANG;
}

/**
 * @param lang language tag ("fr", "fr-CA"...), English when none is given
 * @param overrides texts replacing those of the locale
 * @returns the texts of the locale (see resolveLang()), completed by English
 */
export function resolveStrings(
	lang?: string,
	overrides?: Partial<KnCaptchaStrings>,
): KnCaptchaStrings {
	const strings = {
		...registry[DEFAULT_LANG],
		...registry[resolveLang(lang)],
	};
	// Only the texts given: an undefined one (from JavaScript or a Vue prop) keeps the text of the locale
	for (const [key, text] of Object.entries(overrides ?? {})) {
		if (typeof text === "string" && key in strings) {
			strings[key as keyof KnCaptchaStrings] = text;
		}
	}
	return strings;
}
