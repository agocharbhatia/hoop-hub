import { runDataHealthCli } from '../src/lib/server/nightly/data-health-cli';

try {
	process.exitCode = runDataHealthCli(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 2;
}
