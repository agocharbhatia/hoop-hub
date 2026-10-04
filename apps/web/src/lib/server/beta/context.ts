import { AsyncLocalStorage } from 'node:async_hooks';

export type ResearchPrincipal = { userId: string; email: string; name: string; mode: 'local' | 'invite'; requestId?: string; runId?: string };
const requestContext = new AsyncLocalStorage<ResearchPrincipal>();

/** Carries ownership through parallel tools, streaming responses and async model calls. */
export function withPrincipal<T>(principal: ResearchPrincipal, work: () => T): T { return requestContext.run(principal, work); }
export function currentPrincipal(): ResearchPrincipal | undefined { return requestContext.getStore(); }
export function currentOwnerId(): string { return currentPrincipal()?.userId ?? 'local'; }

export const LOCAL_PRINCIPAL: ResearchPrincipal = { userId: 'local', email: '', name: 'Local workspace', mode: 'local' };
