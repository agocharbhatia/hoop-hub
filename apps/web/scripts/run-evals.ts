import { runEvalCli } from '../src/lib/server/eval/cli';

try {
	process.exitCode = await runEvalCli(process.argv.slice(2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
