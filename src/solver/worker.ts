import { EquihashSolver } from "./equihash";
import type { ResultMessage, TaskMessage } from "./messages";
import { runProof } from "./proof";

/**
 * Web worker: one Equihash run per message. The solver and its buffers (about 10 MB for Equihash(96, 5)) are kept
 * between runs.
 */

// The DOM and WebWorker libs of TypeScript cannot be loaded together: the part of the worker scope used here
interface WorkerScope {
	onmessage: ((event: MessageEvent<TaskMessage>) => void) | null;
	postMessage(message: ResultMessage): void;
}

const scope = globalThis as unknown as WorkerScope;
let solver: EquihashSolver | null = null;

scope.onmessage = ({ data: task }) => {
	try {
		const { n, k } = task.target;
		if (solver === null || solver.layout.n !== n || solver.layout.k !== k) {
			solver = null;
			solver = new EquihashSolver(n, k);
		}
		scope.postMessage({
			id: task.id,
			proof: task.proof,
			result: runProof(solver, task.target, task.proof, task.nonce),
		});
	} catch (e) {
		scope.postMessage({
			id: task.id,
			proof: task.proof,
			result: null,
			error: e instanceof Error ? e.message : String(e),
		});
	}
};
