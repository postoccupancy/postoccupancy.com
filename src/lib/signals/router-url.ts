export const ROUTER_URL_STORAGE_KEY = 'postoccupancy:router-url:v1';
export const DEFAULT_ROUTER_URL = process.env.NEXT_PUBLIC_SIGNAL_ROUTER_URL || 'wss://rf.postoccupancy.com';

export function normalizeRouterUrl(value: string, pageProtocol?: string) {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('Enter a complete router address, including https:// or wss:// and its port.'); }
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new Error('Use an HTTP or WebSocket address without credentials or a fragment.');
  }
  if (pageProtocol === 'https:' && url.protocol === 'ws:') {
    throw new Error('This HTTPS page requires a secure router address (https:// or wss://).');
  }
  return url.pathname === '/' && !url.search ? url.origin : url.href;
}

export function readRouterUrl() {
  try {
    const saved = localStorage.getItem(ROUTER_URL_STORAGE_KEY);
    return saved ? normalizeRouterUrl(saved, location.protocol) : DEFAULT_ROUTER_URL;
  } catch { return DEFAULT_ROUTER_URL; }
}

export function routerHttpOrigin(url: string) {
  return new URL(url.replace(/^ws/, 'http')).origin;
}
