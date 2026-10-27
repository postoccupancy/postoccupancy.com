'use client';
import { useEffect, useRef, type MutableRefObject } from 'react';
import Box from '@mui/material/Box';
import { useDspCourse } from './provider';
import type { DspParameters } from '@/lib/dsp-for-artists/course';
import type { DspAnalysisFrame } from '@/lib/dsp-for-artists/engine';
import { colorAt, WorkshopRenderer } from '@/lib/dsp-for-artists/renderer';

export { colorAt };

export function DspCanvas({external}:{presentation?:boolean;external?:{parameters:DspParameters;frameRef:MutableRefObject<DspAnalysisFrame|null>}}) {
  const course=useDspCourse(),parameters=external?.parameters??course.parameters;
  const externalFrameRef=external?.frameRef,passive=external!==undefined;
  const canvasRef=useRef<HTMLCanvasElement>(null),rendererRef=useRef<WorkshopRenderer|null>(null),parametersRef=useRef(parameters);

  useEffect(()=>{parametersRef.current=parameters;rendererRef.current?.setParameters(parameters)},[parameters]);
  useEffect(()=>{
    const canvas=canvasRef.current!;const renderer=new WorkshopRenderer(canvas,parametersRef.current);rendererRef.current=renderer;const motion=matchMedia('(prefers-reduced-motion: reduce)'),syncMotion=()=>renderer.setReducedMotion(motion.matches);syncMotion();motion.addEventListener('change',syncMotion);
    const unsubscribe=passive?()=>{}:course.engine.subscribe(frame=>renderer.pushFrame(frame));
    const measure=()=>{const box=canvas.getBoundingClientRect();renderer.resize(box.width,box.height,devicePixelRatio||1)};measure();
    const observer=new ResizeObserver(entries=>{const box=entries[0]?.contentRect;if(box)renderer.resize(box.width,box.height,devicePixelRatio||1)});observer.observe(canvas);
    let animation=0,lastExternalSequence=-1,remeasure=true;const draw=(now:number)=>{if(remeasure){remeasure=false;measure()}const frame=externalFrameRef?.current;if(frame&&frame.sequence!==lastExternalSequence){lastExternalSequence=frame.sequence;renderer.pushFrame(frame)}renderer.render(now);animation=requestAnimationFrame(draw)};animation=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(animation);observer.disconnect();unsubscribe();motion.removeEventListener('change',syncMotion);renderer.destroy();rendererRef.current=null};
  },[course.engine,externalFrameRef,passive]);

  const label=parameters.mode==='timeFrequency'?(parameters.analysis==='fft'?'spectrogram':'scalogram'):parameters.mode;
  return <Box sx={{position:'relative',width:'100%',height:'100%',minHeight:320,bgcolor:'#050919'}}><canvas ref={canvasRef} aria-label={`${label} audio visualization`} style={{display:'block',width:'100%',height:'100%'}}/></Box>;
}
