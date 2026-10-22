'use client';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { DocsPage } from '@/layouts/docs/page';
import { lessonBySlug, type LessonSlug } from '@/lib/dsp-for-artists/course';
import { DspWorkspace } from './workspace';

export function DspRouteShell({children}:{children:ReactNode}) {
  const pathname=usePathname(),match=pathname.match(/^\/lab\/dsp-for-artists\/([^/]+)$/),lesson=match?lessonBySlug(match[1]):undefined;
  if(!lesson)return children;
  return <DocsPage title={lesson.title} mode="viewport"><DspWorkspace slug={lesson.slug as LessonSlug}/></DocsPage>;
}
