import {useRef,useState} from 'react';
import {ArrowUp,Footprints,Hand,Truck} from 'lucide-react';
import type {WorldHandle} from '../world/types';
export function TouchControls({world,driving,onInteract,onVehicle,canInteract}:{world:React.RefObject<WorldHandle|null>;driving:boolean;onInteract:()=>void;onVehicle:()=>void;canInteract:boolean}){
 const origin=useRef({x:0,y:0});const [stick,setStick]=useState({x:0,y:0});
 const stop=()=>{setStick({x:0,y:0});world.current?.setInput({forward:0,turn:0,running:false});};
 return <div className="touch-controls">
 <div className="joystick" role="slider" aria-label={driving?'Steer and drive':'Move character'} aria-valuemin={-1} aria-valuemax={1} aria-valuenow={-stick.y/32} tabIndex={0}
 onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);origin.current={x:e.clientX,y:e.clientY};}}
 onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;let x=e.clientX-origin.current.x,y=e.clientY-origin.current.y;const length=Math.hypot(x,y);if(length>32){x=x/length*32;y=y/length*32;}setStick({x,y});world.current?.setInput({forward:-y/32,turn:x/32});}}
 onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}><span className="joystick-cross"/><span className="joystick-stick" style={{transform:`translate(${stick.x}px,${stick.y}px)`}}/></div>
 <div className="touch-actions"><button className="touch-small" aria-label={driving?'Exit pickup':'Enter pickup'} onClick={onVehicle}>{driving?<Footprints/>:<Truck/>}</button><button className="touch-interact" disabled={!canInteract} onClick={onInteract}><Hand/><span>Interact</span></button>{driving&&<button className="touch-small" aria-label="Accelerate" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);world.current?.setInput({forward:1});}} onPointerUp={()=>world.current?.setInput({forward:0})} onPointerCancel={()=>world.current?.setInput({forward:0})}><ArrowUp/></button>}</div>
 </div>;
}
