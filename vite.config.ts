import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { defineConfig, type Plugin } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
	version: string;
};

const banner = `/**
 * KnCaptcha v${pkg.version} (${new Date().toISOString()})
 * Copyright (c) 2023 - 2026 Florent VIALATTE
 * Released under the MIT license
 * Icons: Tabler Icons (MIT)
 */`;

/**
 * Dev server only: challenge and verification endpoints of the demo pages, backed by the reference server of the
 * tests (the PHP library does the same in production)
 * @returns
 */
function demoApi(): Plugin {
	const secret = "demo-secret-demo-secret-demo-secret!";
	const used = new Set<string>();
	const readBody = async (request: IncomingMessage): Promise<string> => {
		let body = "";
		for await (const chunk of request) {
			body += String(chunk);
		}
		return body;
	};

	return {
		name: "kncaptcha-demo-api",
		apply: "serve",
		async configureServer(server) {
			const { issueChallenge, verifySolution } = (await server.ssrLoadModule(
				"/tests/support/server.ts",
			)) as typeof import("./tests/support/server");
			server.middlewares.use("/api/challenge", (request, response) => {
				const url = new URL(request.url ?? "", "http://localhost");
				const bits = Number(url.searchParams.get("bits") ?? 5);
				response.setHeader("Content-Type", "application/json");
				response.setHeader("Cache-Control", "no-store");
				response.end(
					JSON.stringify({
						challenge: issueChallenge(secret, {
							bits,
							ttl: Number(url.searchParams.get("ttl") ?? 300),
						}),
					}),
				);
			});
			server.middlewares.use("/api/verify", (request, response) => {
				void readBody(request).then((body) => {
					const solution = new URLSearchParams(body).get("kncaptcha") ?? "";
					response.setHeader("Content-Type", "application/json");
					response.end(
						JSON.stringify({
							result: verifySolution(secret, solution, {
								used,
							}),
						}),
					);
				});
			});
		},
	};
}

export default defineConfig(({ mode }) => {
	const worker = {
		format: "iife" as const,
	};

	// <script> build: window.KnCaptcha
	if (mode === "iife") {
		return {
			worker,
			build: {
				emptyOutDir: false,
				lib: {
					entry: "src/global.ts",
					name: "KnCaptcha",
					formats: [
						"iife",
					],
					fileName: () => "kncaptcha.iife.js",
				},
				rolldownOptions: {
					output: {
						banner,
						exports: "default",
					},
				},
			},
		};
	}

	// Standalone worker, for a CSP without worker-src blob: (workerUrl option)
	if (mode === "worker") {
		return {
			build: {
				emptyOutDir: false,
				lib: {
					entry: "src/solver/worker.ts",
					name: "KnCaptchaWorker",
					formats: [
						"iife",
					],
					fileName: () => "kncaptcha.worker.js",
				},
				rolldownOptions: {
					output: {
						banner,
					},
				},
			},
		};
	}

	return {
		worker,
		plugins: [
			demoApi(),
		],
		root: ".",
		// pnpm dev, then http://localhost:5173/demo/
		server: {
			// "KnCaptcha-Php" server of the demo: php -S 127.0.0.1:8081 examples/server.php, in the PHP repository
			proxy: {
				"/php": {
					target: "http://127.0.0.1:8081",
					rewrite: (path) => path.replace(/^\/php/, ""),
				},
			},
		},
		build: {
			// First of the builds of `pnpm build`: it empties dist/, the others add to it
			emptyOutDir: true,
			lib: {
				entry: {
					kncaptcha: "src/index.ts",
					vue: "src/vue.ts",
				},
				formats: [
					"es",
				],
			},
			rolldownOptions: {
				external: [
					"vue",
				],
				output: {
					banner,
				},
			},
		},
		test: {
			environment: "happy-dom",
			include: [
				"tests/**/*.test.ts",
			],
			testTimeout: 30_000,
		},
	};
});
