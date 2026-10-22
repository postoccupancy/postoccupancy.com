'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { baseParameters, decodeSketch, encodeSketch, lessonBySlug, validateParameters, type DspParameters, type LessonSlug } from '@/lib/dsp-for-artists/course';
import { DspEngine, type DspEngineContract, type DspEngineStatus } from '@/lib/dsp-for-artists/engine';

interface ContextValue { parameters:DspParameters; ready:boolean; engine:DspEngineContract; audioStatus:DspEngineStatus; startAudio:()=>Promise<void>;enableMicrophone:()=>Promise<void>;pauseAudio:(paused:boolean)=>Promise<void>; enterLesson:(slug:LessonSlug)=>void; setParameter:<K extends keyof DspParameters>(key:K,value:DspParameters[K])=>void; applyParameters:(values:Partial<DspParameters>)=>void; resetLesson:(slug:LessonSlug)=>void; resetAll:()=>void; copyLink:()=>Promise<void>; openPresentation:()=>void; channelRef:React.MutableRefObject<BroadcastChannel|null>; }
const Context = createContext<ContextValue|null>(null);
const STORAGE='dsp-for-artists:v1';
export function DspCourseProvider({children}:{children:ReactNode}) {
 const [parameters,setParameters]=useState(baseParameters),[ready,setReady]=useState(false),[engine]=useState(()=>new DspEngine(baseParameters)),[audioStatus,setAudioStatus]=useState<DspEngineStatus>(()=>engine.getStatus()); const initialized=useRef(false),entered=useRef(new Set<LessonSlug>()),shared=useRef<Partial<DspParameters>>({}); const channelRef=useRef<BroadcastChannel|null>(null); const session=useRef<string>('');
 useEffect(()=>{ if(initialized.current)return; initialized.current=true; let stored:Partial<DspParameters>={}; try{stored=validateParameters(JSON.parse(sessionStorage.getItem(STORAGE)??'{}'));entered.current=new Set(JSON.parse(sessionStorage.getItem(`${STORAGE}:entered`)??'[]'))}catch{} shared.current=decodeSketch(new URLSearchParams(location.search).get('sketch')); setParameters({...baseParameters,...stored});setReady(true); },[]);
 useEffect(()=>{if(!ready)return;engine.configure(parameters);sessionStorage.setItem(STORAGE,JSON.stringify(parameters));channelRef.current?.postMessage({type:'state',parameters});},[engine,parameters,ready]);
 useEffect(()=>engine.subscribe(frame=>channelRef.current?.postMessage({type:'analysis',frame})),[engine]);
 useEffect(()=>engine.subscribeStatus(setAudioStatus),[engine]);
 useEffect(()=>()=>{channelRef.current?.close();void engine.destroy()},[engine]);
 const setParameter=useCallback(<K extends keyof DspParameters>(key:K,value:DspParameters[K])=>setParameters(current=>({...current,[key]:value})),[setParameters]);
 const applyParameters=useCallback((values:Partial<DspParameters>)=>setParameters(current=>({...current,...values})),[setParameters]);
 const enterLesson=useCallback((slug:LessonSlug)=>{if(entered.current.has(slug))return;entered.current.add(slug);sessionStorage.setItem(`${STORAGE}:entered`,JSON.stringify([...entered.current]));setParameters(current=>({...current,...lessonBySlug(slug)!.defaults,...shared.current}));shared.current={};},[setParameters]);
 const resetLesson=useCallback((slug:LessonSlug)=>setParameters(current=>({...current,...lessonBySlug(slug)!.defaults})),[setParameters]);
 const resetAll=useCallback(()=>setParameters(baseParameters),[setParameters]);
 const startAudio=useCallback(async()=>{if(parameters.source==='microphone')await engine.useMicrophone();else await engine.start()},[engine,parameters.source]);
 const enableMicrophone=useCallback(async()=>{await engine.useMicrophone();setParameters(current=>({...current,source:'microphone'}))},[engine,setParameters]);
 const pauseAudio=useCallback((paused:boolean)=>engine.pause(paused),[engine]);
 const copyLink=useCallback(async()=>{const url=new URL(location.href);url.searchParams.set('sketch',encodeSketch(parameters));await navigator.clipboard.writeText(url.toString());},[parameters]);
 const openPresentation=useCallback(()=>{channelRef.current?.close();session.current=crypto.randomUUID();channelRef.current=new BroadcastChannel(`dsp-for-artists:${session.current}`);channelRef.current.onmessage=(event)=>{if(event.data?.type==='ready')channelRef.current?.postMessage({type:'state',parameters})};window.open(`/lab/dsp-for-artists/presentation?session=${session.current}`,'_blank','noopener');channelRef.current.postMessage({type:'state',parameters});},[parameters]);
 const value=useMemo(()=>({parameters,ready,engine,audioStatus,startAudio,enableMicrophone,pauseAudio,enterLesson,setParameter,applyParameters,resetLesson,resetAll,copyLink,openPresentation,channelRef}),[parameters,ready,engine,audioStatus,startAudio,enableMicrophone,pauseAudio,enterLesson,setParameter,applyParameters,resetLesson,resetAll,copyLink,openPresentation]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useDspCourse(){const value=useContext(Context);if(!value)throw new Error('DSP course provider missing');return value;}
