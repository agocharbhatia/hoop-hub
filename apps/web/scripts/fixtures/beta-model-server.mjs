import { createServer } from 'node:http';

// An independent Node HTTP fixture makes disconnect verification immune to Bun's Node HTTP shim.
let calls = 0;
let cancelled = 0;
let delay = 10;
const server = createServer((request, response) => {
	if (request.url === '/fixture/status') {
		response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ calls, cancelled }));
		return;
	}
	if (request.url === '/fixture/delay') { delay = 1500; response.writeHead(204).end(); return; }
	if (request.url !== '/v1/chat/completions') { response.writeHead(404).end(); return; }
	request.resume();
	calls++;
	const timer = setTimeout(() => {
		response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
			id: 'synthetic-completion', object: 'chat.completion', created: 0, model: 'synthetic-model',
			choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
				answer: 'This synthetic out-of-scope question has no NBA evidence.', artifacts: [],
				warnings: [{ kind: 'capability_limit', message: 'Synthetic scope is outside NBA statistics.' }]
			}) } }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 }
		}));
	}, delay);
	response.once('close', () => { clearTimeout(timer); if (!response.writableEnded) cancelled++; });
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ port: server.address().port })));
process.once('SIGTERM', () => { server.closeAllConnections(); server.close(); });
