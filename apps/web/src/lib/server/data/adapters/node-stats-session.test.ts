import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, test } from 'node:test';
import { createNodeStatsSession } from './node-stats-session-client';

const sessionsToClose: Array<{ close(): Promise<void> }> = [];

/* Helper functions */

function isLoopbackListenUnavailable(error: unknown): boolean {
	if (!error || typeof error !== 'object' || !('code' in error)) {
		return false;
	}
	return error.code === 'EADDRINUSE' || error.code === 'EPERM' || error.code === 'EACCES';
}

function listenOnLoopback(server: Server): Promise<{ ok: true } | { ok: false; error: unknown }> {
	return new Promise((resolve) => {
		const cleanup = () => {
			server.off('listening', onListening);
			server.off('error', onError);
		};
		const onListening = () => {
			cleanup();
			resolve({ ok: true });
		};
		const onError = (error: unknown) => {
			cleanup();
			resolve({ ok: false, error });
		};

		server.once('listening', onListening);
		server.once('error', onError);
		try {
			server.listen(0, '127.0.0.1');
		} catch (error) {
			cleanup();
			resolve({ ok: false, error });
		}
	});
}

describe('node-stats-session', () => {
	afterEach(async () => {
		while (sessionsToClose.length > 0) {
			await sessionsToClose.pop()?.close();
		}
	});

	test('reuses one direct keep-alive socket across sequential requests', async () => {
		const sockets = new Set<string>();
		let requestCount = 0;

		const server = createServer((request, response) => {
			requestCount += 1;
			response.setHeader('content-type', 'application/json');
			response.end(JSON.stringify({ path: request.url ?? '/' }));
		});

		server.on('connection', (socket) => {
			sockets.add(`${socket.remoteAddress}:${socket.remotePort}`);
		});

		const listenResult = await listenOnLoopback(server);
		if (!listenResult.ok) {
			if (isLoopbackListenUnavailable(listenResult.error)) {
				return;
			}
			throw listenResult.error;
		}

		const { port } = server.address() as AddressInfo;
		const session = createNodeStatsSession();
		sessionsToClose.push(session);

		try {
			const first = await session.request(new URL(`http://127.0.0.1:${port}/first`), 2_000, {});
			const second = await session.request(new URL(`http://127.0.0.1:${port}/second`), 2_000, {});

			assert.equal(JSON.parse(first.rawText).path, '/first');
			assert.equal(JSON.parse(second.rawText).path, '/second');
			assert.equal(requestCount, 2);
			assert.equal(sockets.size, 1);
		} finally {
			server.close();
			await once(server, 'close');
		}
	});
});
