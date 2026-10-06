'use client';

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { RouterClient } from '@/lib/signals/router-client';
import { RouterInterface } from '@/lib/router/router-interface';

const RouterContext = createContext<RouterClient | null>(null);
const RouterInterfaceContext = createContext<RouterInterface | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [router] = useState(() => new RouterClient());
  const [routerInterface] = useState(() => new RouterInterface(router));
  useEffect(() => router.connect(process.env.NEXT_PUBLIC_SIGNAL_ROUTER_URL || 'wss://rf.postoccupancy.com'), [router]);
  useEffect(() => routerInterface.start(), [routerInterface]);
  return (
    <RouterContext.Provider value={router}>
      <RouterInterfaceContext.Provider value={routerInterface}>{children}</RouterInterfaceContext.Provider>
    </RouterContext.Provider>
  );
}

export function useSignalRouter() {
  const router = useContext(RouterContext);
  if (!router) throw new Error('useSignalRouter requires RouterProvider');
  useSyncExternalStore(router.subscribe, router.getSnapshot, router.getServerSnapshot);
  return router;
}

export function useRouterInterface() {
  const model = useContext(RouterInterfaceContext);
  if (!model) throw new Error('useRouterInterface requires RouterProvider');
  useSyncExternalStore(model.subscribe, model.getSnapshot, model.getServerSnapshot);
  return model;
}
