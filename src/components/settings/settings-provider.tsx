'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface SettingsContextValue {
  presentationDelay: number;
  setPresentationDelay: (delay: number) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [presentationDelay, setPresentationDelay] = useState(6);
  const value = useMemo(() => ({ presentationDelay, setPresentationDelay }), [presentationDelay]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const settings = useContext(SettingsContext);
  if (!settings) throw new Error('useSettings requires SettingsProvider');
  return settings;
}
