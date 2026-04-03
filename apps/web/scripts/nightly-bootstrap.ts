import { closeDataStore } from '../src/lib/server/data/store';
import { runNightlyBootstrapCli } from '../src/lib/server/nightly/bootstrap-cli';

try {
	await runNightlyBootstrapCli(process.argv.slice(2));
	closeDataStore();
	process.exit(0);
} catch (error) {
	closeDataStore();
	console.error(error instanceof Error ? error.stack ?? error.message : String(error));
	process.exit(1);
}
