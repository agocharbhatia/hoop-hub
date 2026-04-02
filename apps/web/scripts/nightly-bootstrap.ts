import { runNightlyBootstrapCli } from '../src/lib/server/nightly/bootstrap-cli';

await runNightlyBootstrapCli(process.argv.slice(2));
