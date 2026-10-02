import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { nodeStatsTransportAssets } from './scripts/node-stats-transport-assets';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), nodeStatsTransportAssets()]
});
