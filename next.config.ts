import type { NextConfig } from 'next';
import createMDX from '@next/mdx';

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  pageExtensions: ['js', 'jsx', 'ts', 'tsx', 'mdx'],
};

export default createMDX()(nextConfig);
