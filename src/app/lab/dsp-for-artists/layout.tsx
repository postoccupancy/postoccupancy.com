import type { ReactNode } from 'react';import { DspCourseProvider } from '@/components/dsp-for-artists/provider';
export default function Layout({children}:{children:ReactNode}){return <DspCourseProvider>{children}</DspCourseProvider>}
