/**
 * - `network`: the challenge could not be fetched
 * - `challenge`: the server sent something that is not a valid challenge
 * - `solver`: the proof of work failed (worker crash, out of memory...)
 */
export type KnCaptchaErrorCode = "network" | "challenge" | "solver";

export class KnCaptchaError extends Error {
	override readonly name = "KnCaptchaError";

	constructor(
		readonly code: KnCaptchaErrorCode,
		message: string,
		options?: {
			cause?: unknown;
		},
	) {
		super(message, options);
	}
}
