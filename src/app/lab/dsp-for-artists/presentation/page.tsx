import type { Metadata } from 'next';import { Suspense } from 'react';import { DspPresentation } from '@/components/dsp-for-artists/presentation';
export const metadata:Metadata={title:'DSP for Artists — Presentation'};
export default function Page(){return <Suspense><DspPresentation/></Suspense>}
