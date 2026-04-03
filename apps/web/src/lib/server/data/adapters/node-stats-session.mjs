import { Agent as HttpAgent, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { createInterface } from 'node:readline';
import { connect as tlsConnect } from 'node:tls';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

const directHttpAgent = new HttpAgent({
	keepAlive: true,
	maxSockets: 4,
	maxFreeSockets: 4,
	scheduling: 'lifo'
});
const directHttpsAgent = new HttpsAgent({
	keepAlive: true,
	maxSockets: 4,
	maxFreeSockets: 4,
	scheduling: 'lifo'
});
const inFlightRequests = new Set();
let writeChain = Promise.resolve();

/* Helper functions */

function buildTimeoutError(timeoutMs) {
	const error = new Error(`Request timed out after ${timeoutMs}ms`);
	error.name = 'AbortError';
	return error;
}

function withPhase(error, phase, context) {
	if (!(error instanceof Error)) {
		return new Error(`phase=${phase}; ${String(error)}`);
	}

	error.message = `phase=${phase}; ${context}; ${error.message}`;
	return error;
}

function maskProxyUrl(proxyArg) {
	try {
		const parsed = new URL(proxyArg);
		const port = parsed.port ? `:${parsed.port}` : '';
		const auth = parsed.username || parsed.password ? `${decodeURIComponent(parsed.username)}:***@` : '';
		return `${parsed.protocol}//${auth}${parsed.hostname}${port}`;
	} catch {
		return proxyArg;
	}
}

function createDecoderStream(contentEncoding) {
	const normalized = String(contentEncoding ?? '').toLowerCase();
	if (normalized.includes('br')) {
		return createBrotliDecompress();
	}

	if (normalized.includes('gzip')) {
		return createGunzip();
	}

	if (normalized.includes('deflate')) {
		return createInflate();
	}

	return null;
}

function readStreamText(stream) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		stream.on('data', (chunk) => {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		});
		stream.on('end', () => {
			resolve(Buffer.concat(chunks).toString('utf8'));
		});
		stream.on('error', reject);
	});
}

function writeMessage(message) {
	writeChain = writeChain.then(
		() =>
			new Promise((resolve, reject) => {
				process.stdout.write(`${JSON.stringify(message)}\n`, (error) => {
					if (error) {
						reject(error);
						return;
					}

					resolve(undefined);
				});
			})
	);
	return writeChain;
}

function requestViaDirectAgent(targetUrl, headers, timeoutMs) {
	return new Promise((resolve, reject) => {
		const requestFn = targetUrl.protocol === 'http:' ? httpRequest : httpsRequest;
		const agent = targetUrl.protocol === 'http:' ? directHttpAgent : directHttpsAgent;
		let currentPhase = 'direct_request';
		let settled = false;
		let request = null;

		const settleResolve = (value) => {
			if (settled) {
				return;
			}

			settled = true;
			resolve(value);
		};

		const settleReject = (error) => {
			if (settled) {
				return;
			}

			settled = true;
			request?.destroy();
			reject(withPhase(error, currentPhase, 'proxy=none'));
		};

		const handleResponse = async (response) => {
			try {
				currentPhase = 'upstream_read';
				const decoder = createDecoderStream(response.headers['content-encoding']);
				const source = decoder ? response.pipe(decoder) : response;
				const rawText = await readStreamText(source);
				settleResolve({
					statusCode: response.statusCode ?? 0,
					rawText
				});
			} catch (error) {
				settleReject(error);
			}
		};

		request = requestFn(
			targetUrl,
			{
				method: 'GET',
				headers,
				agent
			},
			handleResponse
		);
		request.setTimeout(timeoutMs, () => {
			request.destroy(buildTimeoutError(timeoutMs));
		});
		request.on('error', settleReject);
		request.end();
	});
}

function requestViaProxy(targetUrl, headers, timeoutMs, proxyArg) {
	return new Promise((resolve, reject) => {
		let currentPhase = 'proxy_connect';
		const proxyContext = `proxy=${maskProxyUrl(proxyArg)}`;
		let settled = false;
		let proxyRequest = null;
		let proxySocket = null;
		let upstreamRequest = null;
		let upstreamSocket = null;

		const cleanup = () => {
			proxyRequest?.destroy();
			upstreamRequest?.destroy();
			upstreamSocket?.destroy();
			proxySocket?.destroy();
		};

		const settleResolve = (value) => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();
			resolve(value);
		};

		const settleReject = (error) => {
			if (settled) {
				return;
			}

			settled = true;
			cleanup();
			reject(withPhase(error, currentPhase, proxyContext));
		};

		const handleResponse = async (response) => {
			try {
				currentPhase = 'upstream_read';
				const decoder = createDecoderStream(response.headers['content-encoding']);
				const source = decoder ? response.pipe(decoder) : response;
				const rawText = await readStreamText(source);
				settleResolve({
					statusCode: response.statusCode ?? 0,
					rawText
				});
			} catch (error) {
				settleReject(error);
			}
		};

		const proxyUrl = new URL(proxyArg);
		proxyRequest = (proxyUrl.protocol === 'https:' ? httpsRequest : httpRequest)({
			host: proxyUrl.hostname,
			port: proxyUrl.port || (proxyUrl.protocol === 'https:' ? 443 : 80),
			method: 'CONNECT',
			path: `${targetUrl.hostname}:${targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80)}`,
			headers: {
				Host: `${targetUrl.hostname}:${targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80)}`,
				...(proxyUrl.username || proxyUrl.password
					? {
							'Proxy-Authorization': `Basic ${Buffer.from(
								`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`
							).toString('base64')}`
						}
					: {})
			}
		});

		proxyRequest.setTimeout(timeoutMs, () => {
			proxyRequest.destroy(buildTimeoutError(timeoutMs));
		});
		proxyRequest.on('error', settleReject);
		proxyRequest.on('connect', (response, socket, head) => {
			if ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300) {
				socket.destroy();
				settleReject(new Error(`Proxy CONNECT failed with HTTP ${response.statusCode ?? 0}`));
				return;
			}

			proxySocket = socket;
			if (head.length > 0) {
				socket.unshift(head);
			}

			currentPhase = targetUrl.protocol === 'https:' ? 'upstream_tls' : 'upstream_response';
			const requestFn = targetUrl.protocol === 'https:' ? httpsRequest : httpRequest;
			upstreamRequest = requestFn(
				targetUrl,
				{
					method: 'GET',
					headers,
					agent: false,
					createConnection: () =>
						targetUrl.protocol === 'https:'
							? tlsConnect({
									socket,
									servername: targetUrl.hostname
								})
							: socket
				},
				handleResponse
			);
			upstreamRequest.setTimeout(timeoutMs, () => {
				upstreamRequest.destroy(buildTimeoutError(timeoutMs));
			});
			upstreamRequest.on('socket', (tlsSocket) => {
				upstreamSocket = tlsSocket;
				if (targetUrl.protocol === 'https:') {
					tlsSocket.once('secureConnect', () => {
						currentPhase = 'upstream_response';
					});
				}
			});
			upstreamRequest.on('error', settleReject);
			upstreamRequest.end();
		});
		proxyRequest.end();
	});
}

async function handleRequest(message) {
	const targetUrl = new URL(message.url);
	if (message.proxyUrl) {
		return requestViaProxy(targetUrl, message.headers ?? {}, message.timeoutMs, message.proxyUrl);
	}

	return requestViaDirectAgent(targetUrl, message.headers ?? {}, message.timeoutMs);
}

async function shutdown(code) {
	await Promise.allSettled(Array.from(inFlightRequests));
	directHttpAgent.destroy();
	directHttpsAgent.destroy();
	process.exit(code);
}

/* Request loop */

const lines = createInterface({
	input: process.stdin,
	crlfDelay: Infinity
});

lines.on('line', (line) => {
	const trimmed = line.trim();
	if (!trimmed) {
		return;
	}

	let message;
	try {
		message = JSON.parse(trimmed);
	} catch (error) {
		const responsePromise = writeMessage({
			id: null,
			error: error instanceof Error ? error.message : String(error)
		});
		inFlightRequests.add(responsePromise);
		responsePromise.finally(() => {
			inFlightRequests.delete(responsePromise);
		});
		return;
	}

	const requestPromise = (async () => {
		try {
			const result = await handleRequest(message);
			await writeMessage({
				id: message.id,
				statusCode: result.statusCode,
				rawText: result.rawText
			});
		} catch (error) {
			await writeMessage({
				id: message.id,
				error: error instanceof Error ? error.message : String(error)
			});
		}
	})();

	inFlightRequests.add(requestPromise);
	requestPromise.finally(() => {
		inFlightRequests.delete(requestPromise);
	});
});

lines.on('close', () => {
	void shutdown(0);
});

process.stdin.on('error', async (error) => {
	await writeMessage({
		id: null,
		error: error instanceof Error ? error.message : String(error)
	});
	await shutdown(1);
});
