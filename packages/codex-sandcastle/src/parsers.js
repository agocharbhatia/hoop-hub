function escapeForRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractTaggedJson(text, tagName) {
	const pattern = new RegExp(`<${escapeForRegex(tagName)}>([\\s\\S]*?)<\\/${escapeForRegex(tagName)}>`);
	const match = pattern.exec(text);
	if (!match) {
		throw new Error(`Missing <${tagName}> tag in agent output.`);
	}

	try {
		return JSON.parse(match[1].trim());
	} catch (error) {
		throw new Error(`Invalid JSON inside <${tagName}> tag: ${String(error)}`);
	}
}

export function hasPromiseToken(text, token = 'COMPLETE') {
	const pattern = new RegExp(`<promise>\\s*${escapeForRegex(token)}\\s*<\\/promise>`, 'i');
	return pattern.test(text);
}
