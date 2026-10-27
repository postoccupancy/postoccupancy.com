import {expect,test,WebSocketRoute} from '@playwright/test';

test('Electric Sea wavefronts retain their emission color across pitch and blend changes',async({page})=>{
 let socket!:WebSocketRoute;
 await page.routeWebSocket('wss://rf.postoccupancy.com',ws=>{socket=ws});
 await page.goto('/instruments/wave-interference');
 const select=async(label:string,option:string)=>{
  await page.getByRole('combobox',{name:label,exact:true}).click();
  await page.getByRole('option',{name:option,exact:true}).click();
 };
 const canvas=page.getByLabel('Wave Interference visualization');
 const emittedColors=async()=>((await canvas.getAttribute('data-emitted-colors'))?.match(/value::1:([^|]+)/)?.[1].split(',')??[]);
 await select('Visualization','Plane Waves');
 await select('Input','Electric Sea');
 socket.send(JSON.stringify({type:'resident_voices',device:'osc/test/value',ready:true,voices:[{id:1,active:true,frequencyHz:.05,confidence:.9}]}));
 await expect.poll(async()=>(await emittedColors()).length).toBe(1);
 const warm=(await emittedColors())[0];
 socket.send(JSON.stringify({type:'resident_voices',device:'osc/test/value',ready:true,voices:[{id:1,active:true,frequencyHz:.4,confidence:.9}]}));
 await expect.poll(async()=>(await emittedColors()).length).toBe(2);
 const changed=await emittedColors();
 expect(changed[0]).toBe(warm);
 expect(changed[1]).not.toBe(warm);
 await select('Blend','Multiply');
 expect(await emittedColors()).toEqual(changed);
 await select('Blend','Color Edge');
 await page.waitForTimeout(100);
 const edge=await canvas.evaluate(node=>{const data=(node as HTMLCanvasElement).getContext('2d')!.getImageData(0,0,(node as HTMLCanvasElement).width,(node as HTMLCanvasElement).height).data;let dark=0,chromatic=0;for(let index=0;index<data.length;index+=16){const r=data[index],g=data[index+1],b=data[index+2];if(Math.max(r,g,b)<16)dark++;if(Math.max(r,g,b)-Math.min(r,g,b)>8)chromatic++;}return{dark,chromatic}});
 expect(edge.dark).toBeGreaterThan(100);
 expect(edge.chromatic).toBeGreaterThan(100);
 expect(await emittedColors()).toEqual(changed);
 await select('Input','Manual Oscillators');
 await expect(canvas).toHaveAttribute('data-emitted-colors','');
});
