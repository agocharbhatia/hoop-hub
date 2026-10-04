import { createInvite, revokeUser } from '../src/lib/server/beta/auth';
import { getBetaStore } from '../src/lib/server/beta/store';
import { backupDatabase, restoreDatabase } from '../src/lib/server/beta/backup';
import { readinessChecks } from '../src/lib/server/beta/readiness';

process.umask(0o077);

/** Offline operator commands avoid an exposed admin API and require access to the private server. */
export function runAdmin(args: string[]): void {
	const [command, ...values] = args;
	const store = getBetaStore();
	try {
		if (command === 'invite') {
			if (values.length !== 2) throw new Error('Usage: beta:admin invite email "Display name"');
			const origin = process.env.ORIGIN ?? process.env.HOOP_HUB_APP_ORIGIN;
			if (!origin || new URL(origin).origin !== origin) throw new Error('Set ORIGIN to the beta application origin first.');
			const invite = createInvite(values[0], values[1], store);
			console.log(`One-use invitation (expires in 72 hours):\n${origin}/login#invite=${invite.token}`);
		} else if (command === 'revoke') {
			if (values.length !== 1) throw new Error('Usage: beta:admin revoke email');
			revokeUser(values[0], store); console.log('Account access and sessions revoked.');
		} else if (command === 'status') {
			const checks = readinessChecks({ refresh: true });
			console.log(JSON.stringify({ ready: checks.every((check) => check.ok), checks }, null, 2));
		} else if (command === 'feedback') {
			// Feedback is private; explicit offline access is the operator authorization boundary.
			console.log(JSON.stringify(store.db.query(`SELECT f.id,f.kind,f.comment,f.created_at,t.question,t.response_json,f.trace_id
				FROM beta_feedback f LEFT JOIN research_turns t ON t.turn_id=f.turn_id ORDER BY f.created_at DESC LIMIT 100`).all(), null, 2));
		} else if (command === 'backup') {
			const directory = values[0] ?? process.env.HOOP_HUB_BACKUP_DIR;
			if (!directory) throw new Error('Provide a backup directory.');
			console.log(backupDatabase(store.data, directory));
		} else if (command === 'restore') {
			if (values.length !== 2) throw new Error('Usage: beta:admin restore manifest.json new-database.sqlite');
			restoreDatabase(values[0], values[1]); console.log('Restored and verified. Stop the server before switching its database path.');
		} else throw new Error('Commands: invite, revoke, status, feedback, backup, restore.');
	} finally { store.data.close(); }
}

if (import.meta.main) {
	try { runAdmin(process.argv.slice(2)); }
	catch (error) { console.error(error instanceof Error ? error.message : 'Operator command failed.'); process.exitCode = 1; }
}
