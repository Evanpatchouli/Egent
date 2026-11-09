import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL('../../', import.meta.url));
  const env = loadEnv(mode, envDir, '');
  const port = Number(env.WEB_PORT ?? '5173');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('WEB_PORT must be an integer between 1 and 65535.');
  }
  return {
    plugins: [react()],
    envDir,
    server: { host: env.WEB_HOST ?? '0.0.0.0', port, strictPort: true },
  };
});
