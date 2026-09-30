/**
 * @param value
 * @param what named in the error
 * @returns the value, known to be present
 * @throws Error when the value is null or undefined
 */
export function defined<T>(value: T | null | undefined, what = "value"): T {
	if (value === null || value === undefined) {
		throw new Error(`Missing ${what}`);
	}
	return value;
}

/**
 * @param selector
 * @param root
 * @returns the first matching element
 * @throws Error when nothing matches
 */
export function query<T extends Element = HTMLElement>(
	selector: string,
	root: ParentNode = document,
): T {
	return defined(root.querySelector<T>(selector), selector);
}
