import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = ({ locals }) => ({ user: locals.user ? { name: locals.user.name, email: locals.user.email, mode: locals.user.mode } : null });
