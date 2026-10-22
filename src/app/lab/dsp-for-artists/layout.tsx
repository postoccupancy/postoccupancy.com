import type { ReactNode } from 'react';import { DspCourseProvider } from '@/components/dsp-for-artists/provider';import { DspRouteShell } from '@/components/dsp-for-artists/route-shell';
export default function Layout({children}:{children:ReactNode}){return <DspCourseProvider><DspRouteShell>{children}</DspRouteShell></DspCourseProvider>}
