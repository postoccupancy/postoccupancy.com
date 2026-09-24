'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { RouterClient } from '@/lib/signals/router-client';

const RouterContext = createContext<RouterClient | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [router] = useState(() => new RouterClient());
  useEffect(() => router.connect(process.env.NEXT_PUBLIC_SIGNAL_ROUTER_URL || 'wss://rf.postoccupancy.com'), [router]);
  return <RouterContext.Provider value={router}>{children}</RouterContext.Provider>;
}

export function useSignalRouter() {
  const router = useContext(RouterContext);
  if (!router) throw new Error('useSignalRouter requires RouterProvider');
  useSyncExternalStore(router.subscribe, router.getSnapshot, router.getServerSnapshot);
  return router;
}
