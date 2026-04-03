import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

export type LiveStatsTextResponse = {
	statusCode: number;
	rawText: string;
};

export type NodeStatsSession = {
	request(url: URL, timeoutMs: number, headers: Record<string, string>, proxyUrl?: string): Promise<LiveStatsTextResponse>;
	close(): Promise<void>;
};

type PendingRequest = {
	resolve: (value: LiveStatsTextResponse) => void;
	reject: (error: Error) => void;
};

type SessionResponseMessage = {
	id: string | null;
	statusCode?: number;
	rawText?: string;
	error?: string;
};

const NODE_STATS_SESSION_SCRIPT = fileURLToPath(new URL('./node-stats-session.mjs', import.meta.url));

/* Helper functions */

function buildChildExitError(code: number | null, signal: NodeJS.Signals | null, stderr: string): Error {
	const stderrSuffix = stderr.trim() ? `; ${stderr.trim()}` : '';
	return new Error(`Node stats session exited with code=${String(code)} signal=${String(signal)}${stderrSuffix}`);
}

function parseResponseLines(buffer: string): { remainder: string; lines: string[] } {
	const lines = buffer.split('\n');
	const remainder = lines.pop() ?? '';
	return { remainder, lines };
}

/* Public session factory */

export function createNodeStatsSession(options?: { scriptPath?: string }): NodeStatsSession {
	const scriptPath = options?.scriptPath ?? NODE_STATS_SESSION_SCRIPT;
	const child = spawn('node', [scriptPath], {
		stdio: ['pipe', 'pipe', 'pipe']
	});
	const pending = new Map<string, PendingRequest>();
	let stdoutBuffer = '';
	let stderrBuffer = '';
	let closed = false;
	let closePromise: Promise<void> | null = null;

	const rejectAllPending = (error: Error) => {
		for (const request of pending.values()) {
			request.reject(error);
		}
		pending.clear();
	};

	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk: string) => {
		stderrBuffer = `${stderrBuffer}${chunk}`.slice(-8_192);
	});

	child.stdout.setEncoding('utf8');
	child.stdout.on('data', (chunk: string) => {
		stdoutBuffer += chunk;
		const { remainder, lines } = parseResponseLines(stdoutBuffer);
		stdoutBuffer = remainder;

		for (const line of lines) {
			if (!line.trim()) {
				continue;
			}

			let message: SessionResponseMessage;
			try {
				message = JSON.parse(line) as SessionResponseMessage;
			} catch (error) {
				rejectAllPending(error instanceof Error ? error : new Error(String(error)));
				continue;
			}

			if (!message.id) {
				if (message.error) {
					rejectAllPending(new Error(message.error));
				}
				continue;
			}

			const request = pending.get(message.id);
			if (!request) {
				continue;
			}

			pending.delete(message.id);
			if (message.error) {
				request.reject(new Error(message.error));
				continue;
			}

			request.resolve({
				statusCode: message.statusCode ?? 0,
				rawText: message.rawText ?? ''
			});
		}
	});

	child.on('error', (error) => {
		rejectAllPending(error instanceof Error ? error : new Error(String(error)));
	});

	child.on('close', (code, signal) => {
		closed = true;
		rejectAllPending(buildChildExitError(code, signal, stderrBuffer));
	});

	return {
		request(url, timeoutMs, headers, proxyUrl) {
			if (closed) {
				return Promise.reject(new Error('Node stats session is already closed.'));
			}

			const id = crypto.randomUUID();
			const line = `${JSON.stringify({
				id,
				url: url.toString(),
				timeoutMs,
				headers,
				proxyUrl: proxyUrl ?? null
			})}\n`;

			return new Promise<LiveStatsTextResponse>((resolve, reject) => {
				pending.set(id, { resolve, reject });
				child.stdin.write(line, (error) => {
					if (!error) {
						return;
					}

					pending.delete(id);
					reject(error instanceof Error ? error : new Error(String(error)));
				});
			});
		},
		async close() {
			if (closePromise) {
				return closePromise;
			}

			closePromise = (async () => {
				if (closed) {
					return;
				}

				child.stdin.end();
				await once(child, 'close');
			})();

			return closePromise;
		}
	};
}
