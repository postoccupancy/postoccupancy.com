import type { Metadata } from 'next';import { notFound } from 'next/navigation';import { lessonBySlug, lessonSlugs } from '@/lib/dsp-for-artists/course';
export function generateStaticParams(){return lessonSlugs.map(lesson=>({lesson}))}
export async function generateMetadata({params}:{params:Promise<{lesson:string}>}):Promise<Metadata>{const {lesson:slug}=await params,lesson=lessonBySlug(slug);if(!lesson)return{};return{title:`${lesson.title} | Post Occupancy Media`,description:lesson.summary}}
export default async function Page({params}:{params:Promise<{lesson:string}>}){const {lesson:slug}=await params;if(!lessonBySlug(slug))notFound();return null}
