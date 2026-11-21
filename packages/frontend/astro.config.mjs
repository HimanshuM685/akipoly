import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

export default defineConfig({
  integrations: [react()],
  // Static output everywhere except routes marked `prerender = false`,
  // which Vercel builds as serverless functions.
  adapter: vercel(),
});
