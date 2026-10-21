type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const MAX_AGE_MS = 7 * 86_400_000;
const MAX_BYTES = 100_000;

/** Recover interrupted work within this tab without mixing drafts between signed-in accounts. */
export function createWorkspaceDrafts(storage: DraftStorage, owner: string, now = Date.now) {
	const prefix = `hoop-hub:drafts:v1:${encodeURIComponent(owner)}:`;
	return {
		read<T>(key: string, valid: (value: unknown) => value is T): T | undefined {
			try {
				const raw = storage.getItem(prefix + key);
				if (!raw || raw.length > MAX_BYTES) return;
				const entry = JSON.parse(raw);
				if (typeof entry.savedAt !== 'number' || now() - entry.savedAt > MAX_AGE_MS || !valid(entry.value)) return;
				return entry.value;
			} catch { return; }
		},
		write(key: string, value: unknown): boolean {
			try {
				const raw = JSON.stringify({ savedAt: now(), value });
				if (raw.length > MAX_BYTES) return false;
				storage.setItem(prefix + key, raw);
				return true;
			} catch { return false; }
		},
		remove(key: string): void { try { storage.removeItem(prefix + key); } catch { /* Navigation protection remains available when storage is blocked. */ } }
	};
}

export type WorkspaceDrafts = ReturnType<typeof createWorkspaceDrafts>;

/* Draft validation helpers */
export function isQuestionDraft(value: unknown): value is string { return typeof value === 'string' && value.length <= 4000; }
/* End draft validation helpers */
