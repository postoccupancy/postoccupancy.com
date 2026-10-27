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
 await select('Input','Manual Oscillators');
 await expect(canvas).toHaveAttribute('data-emitted-colors','');
});
