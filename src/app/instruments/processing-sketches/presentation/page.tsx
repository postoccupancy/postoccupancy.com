import { Suspense } from 'react';
import { PatternPartyPresentation } from '@/components/pattern-party/presentation';

export default function Page() {
  return <Suspense fallback={null}><PatternPartyPresentation /></Suspense>;
}
