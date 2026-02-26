/// <reference types="node" />
import { listEndpointCatalog } from '../src/lib/server/data/catalog/endpoint-catalog';

const DOC_BASE_URL = 'https://raw.githubusercontent.com/swar/nba_api/master/docs/nba_api/stats/endpoints';
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

type EndpointDocContract = {
	path: string;
	requiredParams: string[];
	optionalParams: string[];
};

function parseArrayValues(markdown: string, key: 'required_parameters' | 'nullable_parameters'): string[] {
	const regex = new RegExp(`"${key}"\\s*:\\s*\\[(.*?)\\]\\s*,`, 's');
	const match = markdown.match(regex);
	if (!match) {
		throw new Error(`Could not parse '${key}' from endpoint markdown.`);
	}

	return match[1]
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value.length > 0)
		.map((value) => value.replace(/^"/, '').replace(/"$/, ''))
		.filter((value) => value.length > 0);
}

function parseEndpointPath(markdown: string): string {
	const match = markdown.match(/##### Endpoint URL\s*\n>\[(https:\/\/stats\.nba\.com\/stats\/[^\]]+)\]/);
	if (!match) {
		throw new Error("Could not parse endpoint URL from markdown.");
	}

	const endpointUrl = new URL(match[1]);
	return endpointUrl.pathname;
}

function normalizeParams(values: string[]): string[] {
	return Array.from(new Set(values)).sort();
}

function paramsDiffMessage(actual: string[], expected: string[]): string {
	const actualSet = new Set(actual);
	const expectedSet = new Set(expected);
	const missing = expected.filter((value) => !actualSet.has(value));
	const unexpected = actual.filter((value) => !expectedSet.has(value));

	const chunks: string[] = [];
	if (missing.length > 0) {
		chunks.push(`missing: [${missing.join(', ')}]`);
	}
	if (unexpected.length > 0) {
		chunks.push(`unexpected: [${unexpected.join(', ')}]`);
	}

	return chunks.join('; ');
}

async function fetchEndpointMarkdown(endpointId: string): Promise<string> {
	const url = `${DOC_BASE_URL}/${endpointId}.md`;
	let lastError: unknown;

	for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		try {
			const response = await fetch(url, {
				headers: {
					'User-Agent': 'HoopHubCatalogContractCheck/1.0'
				},
				signal: controller.signal
			});

			if (!response.ok) {
				throw new Error(`HTTP ${response.status} from ${url}`);
			}

			return await response.text();
		} catch (error) {
			lastError = error;
			if (attempt === MAX_RETRIES) {
				break;
			}

			await new Promise((resolve) => setTimeout(resolve, attempt * 300));
		} finally {
			clearTimeout(timeout);
		}
	}

	throw new Error(`Failed to fetch '${endpointId}' docs after ${MAX_RETRIES} attempts: ${String(lastError)}`);
}

function extractDocContract(markdown: string): EndpointDocContract {
	const requiredParams = parseArrayValues(markdown, 'required_parameters');
	const nullableParams = parseArrayValues(markdown, 'nullable_parameters');
	const optionalParams = nullableParams.filter((param) => !requiredParams.includes(param));

	return {
		path: parseEndpointPath(markdown),
		requiredParams,
		optionalParams
	};
}

async function main(): Promise<void> {
	const catalogEntries = listEndpointCatalog();
	const failures: string[] = [];

	for (const entry of catalogEntries) {
		let markdown: string;
		try {
			markdown = await fetchEndpointMarkdown(entry.endpointId);
		} catch (error) {
			failures.push(`[${entry.endpointId}] doc fetch failed: ${String(error)}`);
			continue;
		}

		let docContract: EndpointDocContract;
		try {
			docContract = extractDocContract(markdown);
		} catch (error) {
			failures.push(`[${entry.endpointId}] doc parse failed: ${String(error)}`);
			continue;
		}

		if (docContract.path !== entry.path) {
			failures.push(`[${entry.endpointId}] path mismatch: catalog='${entry.path}' docs='${docContract.path}'`);
		}

		const actualRequired = normalizeParams(entry.requiredParams);
		const expectedRequired = normalizeParams(docContract.requiredParams);
		if (actualRequired.join('|') !== expectedRequired.join('|')) {
			failures.push(
				`[${entry.endpointId}] requiredParams mismatch (${paramsDiffMessage(actualRequired, expectedRequired)})`
			);
		}

		const actualOptional = normalizeParams(entry.optionalParams);
		const expectedOptional = normalizeParams(docContract.optionalParams);
		if (actualOptional.join('|') !== expectedOptional.join('|')) {
			failures.push(
				`[${entry.endpointId}] optionalParams mismatch (${paramsDiffMessage(actualOptional, expectedOptional)})`
			);
		}
	}

	if (failures.length > 0) {
		console.error('Endpoint catalog contract check failed:\n');
		for (const failure of failures) {
			console.error(`- ${failure}`);
		}
		process.exit(1);
	}

	console.log(`Endpoint catalog contract check passed for ${catalogEntries.length} endpoints.`);
}

await main();
