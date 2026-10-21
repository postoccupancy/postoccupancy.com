'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { baseParameters, decodeSketch, encodeSketch, lessonBySlug, validateParameters, type DspParameters, type LessonSlug } from '@/lib/dsp-for-artists/course';

interface ContextValue { parameters:DspParameters; ready:boolean; enterLesson:(slug:LessonSlug)=>void; setParameter:<K extends keyof DspParameters>(key:K,value:DspParameters[K])=>void; applyParameters:(values:Partial<DspParameters>)=>void; resetLesson:(slug:LessonSlug)=>void; resetAll:()=>void; copyLink:()=>Promise<void>; openPresentation:()=>void; channelRef:React.MutableRefObject<BroadcastChannel|null>; }
const Context = createContext<ContextValue|null>(null);
const STORAGE='dsp-for-artists:v1';
export function DspCourseProvider({children}:{children:ReactNode}) {
 const [parameters,setParameters]=useState(baseParameters),[ready,setReady]=useState(false); const initialized=useRef(false),entered=useRef(new Set<LessonSlug>()),shared=useRef<Partial<DspParameters>>({}); const channelRef=useRef<BroadcastChannel|null>(null); const session=useRef<string>('');
 useEffect(()=>{ if(initialized.current)return; initialized.current=true; let stored:Partial<DspParameters>={}; try{stored=validateParameters(JSON.parse(sessionStorage.getItem(STORAGE)??'{}'));entered.current=new Set(JSON.parse(sessionStorage.getItem(`${STORAGE}:entered`)??'[]'))}catch{} shared.current=decodeSketch(new URLSearchParams(location.search).get('sketch')); setParameters({...baseParameters,...stored});setReady(true); },[]);
 useEffect(()=>{if(!ready)return;sessionStorage.setItem(STORAGE,JSON.stringify(parameters));channelRef.current?.postMessage({type:'state',parameters});},[parameters,ready]);
 useEffect(()=>()=>channelRef.current?.close(),[]);
 const setParameter=useCallback(<K extends keyof DspParameters>(key:K,value:DspParameters[K])=>setParameters(current=>({...current,[key]:value})),[]);
 const applyParameters=useCallback((values:Partial<DspParameters>)=>setParameters(current=>({...current,...values})),[]);
 const enterLesson=useCallback((slug:LessonSlug)=>{if(entered.current.has(slug))return;entered.current.add(slug);sessionStorage.setItem(`${STORAGE}:entered`,JSON.stringify([...entered.current]));setParameters(current=>({...current,...lessonBySlug(slug)!.defaults,...shared.current}));shared.current={};},[]);
 const resetLesson=useCallback((slug:LessonSlug)=>setParameters(current=>({...current,...lessonBySlug(slug)!.defaults})),[]);
 const resetAll=useCallback(()=>setParameters(baseParameters),[]);
 const copyLink=useCallback(async()=>{const url=new URL(location.href);url.searchParams.set('sketch',encodeSketch(parameters));await navigator.clipboard.writeText(url.toString());},[parameters]);
 const openPresentation=useCallback(()=>{channelRef.current?.close();session.current=crypto.randomUUID();channelRef.current=new BroadcastChannel(`dsp-for-artists:${session.current}`);channelRef.current.onmessage=(event)=>{if(event.data?.type==='ready')channelRef.current?.postMessage({type:'state',parameters})};window.open(`/lab/dsp-for-artists/presentation?session=${session.current}`,'_blank','noopener');channelRef.current.postMessage({type:'state',parameters});},[parameters]);
 const value=useMemo(()=>({parameters,ready,enterLesson,setParameter,applyParameters,resetLesson,resetAll,copyLink,openPresentation,channelRef}),[parameters,ready,enterLesson,setParameter,applyParameters,resetLesson,resetAll,copyLink,openPresentation]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDspCourse(){const value=useContext(Context);if(!value)throw new Error('DSP course provider missing');return value;}
