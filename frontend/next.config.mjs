import path from 'node:path';
import { fileURLToPath } from 'node:url';

import nextEnv from '@next/env';

// One .env for the whole repo: the bridge and the console read the same file at the root.
const here = path.dirname(fileURLToPath(import.meta.url));
nextEnv.loadEnvConfig(path.resolve(here, '..'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
