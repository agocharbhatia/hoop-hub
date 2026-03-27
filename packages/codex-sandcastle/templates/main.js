import { runLoop } from '@agocharbhatia/codex-sandcastle';

await runLoop({
	configPath: '.sandcastle/config.json',
	cwd: process.cwd()
});
