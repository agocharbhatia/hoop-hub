import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DEFAULT_CONFIG = {
	maxRounds: 10,
	maxParallelWorkers: 4,
	baseBranch: 'auto',
	branchPrefix: 'sandcastle',
	worktreesDir: './worktrees',
	logsDir: './logs',
	hooks: {
		onAgentReady: []
	},
	github: {
		repo: null,
		issueLabel: 'implementation'
	},
	codex: {
		model: null,
		sandbox: 'danger-full-access',
		approval: 'never',
		ephemeral: true,
		search: false,
		extraArgs: []
	},
	planner: {
		promptFile: './plan-prompt.md'
	},
	worker: {
		promptFile: './implement-prompt.md'
	},
	merger: {
		promptFile: './merge-prompt.md'
	},
	commands: {
		verify: []
	},
	merge: {
		requireCompleteToken: true
	}
};

function mergeConfig(rawConfig) {
	return {
		...DEFAULT_CONFIG,
		...rawConfig,
		hooks: {
			...DEFAULT_CONFIG.hooks,
			...(rawConfig.hooks ?? {})
		},
		github: {
			...DEFAULT_CONFIG.github,
			...(rawConfig.github ?? {})
		},
		codex: {
			...DEFAULT_CONFIG.codex,
			...(rawConfig.codex ?? {})
		},
		planner: {
			...DEFAULT_CONFIG.planner,
			...(rawConfig.planner ?? {})
		},
		worker: {
			...DEFAULT_CONFIG.worker,
			...(rawConfig.worker ?? {})
		},
		merger: {
			...DEFAULT_CONFIG.merger,
			...(rawConfig.merger ?? {})
		},
		commands: {
			...DEFAULT_CONFIG.commands,
			...(rawConfig.commands ?? {})
		},
		merge: {
			...DEFAULT_CONFIG.merge,
			...(rawConfig.merge ?? {})
		}
	};
}

/**
 * Normalizes the config into absolute paths so the runner can work from any cwd.
 */
export function loadConfig(configPath) {
	const absoluteConfigPath = resolve(configPath);
	const configDir = dirname(absoluteConfigPath);
	const rawConfig = JSON.parse(readFileSync(absoluteConfigPath, 'utf8'));
	const config = mergeConfig(rawConfig);

	return {
		...config,
		configPath: absoluteConfigPath,
		configDir,
		worktreesDir: resolve(configDir, config.worktreesDir),
		logsDir: resolve(configDir, config.logsDir),
		planner: {
			...config.planner,
			promptFile: resolve(configDir, config.planner.promptFile)
		},
		worker: {
			...config.worker,
			promptFile: resolve(configDir, config.worker.promptFile)
		},
		merger: {
			...config.merger,
			promptFile: resolve(configDir, config.merger.promptFile)
		}
	};
}
