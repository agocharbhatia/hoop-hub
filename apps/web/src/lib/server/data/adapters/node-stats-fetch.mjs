import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

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

async function main() {
	const [, , urlArg, timeoutArg, headersArg, proxyArg] = process.argv;
	if (!urlArg || !timeoutArg || !headersArg) {
		throw new Error('Expected url, timeout, and headers arguments.');
	}

	const timeoutMs = Number.parseInt(timeoutArg, 10);
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		throw new Error(`Invalid timeout '${timeoutArg}'.`);
	}

	const headers = JSON.parse(headersArg);
	const result = await new Promise((resolve, reject) => {
		let currentPhase = proxyArg ? 'proxy_connect' : 'direct_request';
		const proxyContext = proxyArg ? `proxy=${maskProxyUrl(proxyArg)}` : 'proxy=none';
		let settled = false;
		let directRequest = null;
		let proxyRequest = null;
		let proxySocket = null;
		let upstreamRequest = null;
		let upstreamSocket = null;

		const cleanup = () => {
			directRequest?.destroy();
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
			reject(error);
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
				settleReject(withPhase(error, currentPhase, proxyContext));
			}
		};

		if (!proxyArg) {
			directRequest = httpsRequest(urlArg, { method: 'GET', headers }, handleResponse);
			directRequest.setTimeout(timeoutMs, () => {
				directRequest.destroy(withPhase(buildTimeoutError(timeoutMs), currentPhase, proxyContext));
			});
			directRequest.on('socket', (socket) => {
				upstreamSocket = socket;
			});
			directRequest.on('error', (error) => settleReject(withPhase(error, currentPhase, proxyContext)));
			directRequest.end();
			return;
		}

		const targetUrl = new URL(urlArg);
		const proxyUrl = new URL(proxyArg);
		proxyRequest = (proxyUrl.protocol === 'https:' ? httpsRequest : httpRequest)(
			{
				host: proxyUrl.hostname,
				port: proxyUrl.port || (proxyUrl.protocol === 'https:' ? 443 : 80),
				method: 'CONNECT',
				path: `${targetUrl.hostname}:${targetUrl.port || 443}`,
				headers: {
					Host: `${targetUrl.hostname}:${targetUrl.port || 443}`,
					...(proxyUrl.username || proxyUrl.password
						? {
								'Proxy-Authorization': `Basic ${Buffer.from(
									`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`
								).toString('base64')}`
							}
						: {})
				}
			}
		);

		proxyRequest.setTimeout(timeoutMs, () => {
			proxyRequest.destroy(withPhase(buildTimeoutError(timeoutMs), currentPhase, proxyContext));
		});
		proxyRequest.on('error', (error) => settleReject(withPhase(error, currentPhase, proxyContext)));
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

			currentPhase = 'upstream_tls';

			upstreamRequest = httpsRequest(
				targetUrl,
				{
					method: 'GET',
					headers,
					agent: false,
					createConnection: () =>
						tlsConnect({
							socket,
							servername: targetUrl.hostname
						})
				},
				handleResponse
			);
			upstreamRequest.setTimeout(timeoutMs, () => {
				upstreamRequest.destroy(withPhase(buildTimeoutError(timeoutMs), currentPhase, proxyContext));
			});
			upstreamRequest.on('socket', (tlsSocket) => {
				upstreamSocket = tlsSocket;
				tlsSocket.once('secureConnect', () => {
					currentPhase = 'upstream_response';
				});
			});
			upstreamRequest.on('error', (error) => settleReject(withPhase(error, currentPhase, proxyContext)));
			upstreamRequest.end();
		});
		proxyRequest.end();
	});

	await new Promise((resolve, reject) => {
		process.stdout.write(JSON.stringify(result), (error) => {
			if (error) {
				reject(error);
				return;
			}

			resolve(undefined);
		});
	});
	process.exit(0);
}

main().catch((error) => {
	process.stderr.write(String(error instanceof Error ? error.stack ?? error.message : error), () => {
		process.exit(1);
	});
});
