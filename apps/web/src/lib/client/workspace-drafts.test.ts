import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorkspaceDrafts, isQuestionDraft } from './workspace-drafts';

/* Browser storage fixture helpers */
function memoryStorage() {
	const entries = new Map<string, string>();
	return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}
/* End browser storage fixture helpers */

test('interrupted question drafts restore independently for each account and session', () => {
	const storage = memoryStorage(), first = createWorkspaceDrafts(storage, 'first'), second = createWorkspaceDrafts(storage, 'second');
	assert.equal(first.write('question:one', 'Compare Toronto and Boston'), true);
	assert.equal(first.write('question:two', 'Show Curry shots'), true);
	assert.equal(createWorkspaceDrafts(storage, 'first').read('question:one', isQuestionDraft), 'Compare Toronto and Boston');
	assert.equal(second.read('question:one', isQuestionDraft), undefined);
	first.remove('question:one');
	assert.equal(first.read('question:one', isQuestionDraft), undefined);
	assert.equal(first.read('question:two', isQuestionDraft), 'Show Curry shots');
});

test('expired, malformed and invalid drafts never replace usable input', () => {
	const storage = memoryStorage(); let now = 1000;
	const drafts = createWorkspaceDrafts(storage, 'owner', () => now);
	drafts.write('expired', 'An old question'); now += 8 * 86_400_000;
	assert.equal(drafts.read('expired', isQuestionDraft), undefined);
	drafts.write('wrong-type', { question: 'not a string' });
	assert.equal(drafts.read('wrong-type', isQuestionDraft), undefined);
	storage.entries.set('hoop-hub:drafts:v1:owner:broken', '{');
	assert.equal(drafts.read('broken', isQuestionDraft), undefined);
});

test('storage refusal is reported so the workspace can protect dirty navigation', () => {
	const drafts = createWorkspaceDrafts({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } }, 'owner');
	assert.equal(drafts.write('question:new', 'Keep this question'), false);
	assert.equal(drafts.read('question:new', isQuestionDraft), undefined);
	assert.doesNotThrow(() => drafts.remove('question:new'));
});
