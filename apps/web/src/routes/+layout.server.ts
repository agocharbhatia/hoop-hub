import { listDataProviders } from '$lib/server/data/providers/catalog';
import type { LayoutServerLoad } from './$types';
export const load: LayoutServerLoad = ({ locals }) => ({ possessionAnalytics: listDataProviders().some((provider) => provider.id === 'pbpstats' && provider.available) && process.env.HOOP_HUB_ENABLE_LIVE_PBPSTATS !== '0', user: locals.user ? { name: locals.user.name, email: locals.user.email, mode: locals.user.mode } : null });
