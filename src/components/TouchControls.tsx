import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowUp,Footprints,Hand,Truck} from 'lucide-react';
import type {WorldHandle} from '../world/types';
export function TouchControls({world,driving,onInteract,onVehicle,canInteract}:{world:React.RefObject<WorldHandle|null>;driving:boolean;onInteract:()=>void;onVehicle:()=>void;canInteract:boolean}){
 const origin=useRef({x:0,y:0});const [stick,setStick]=useState({x:0,y:0});
 const stickInput=useRef({x:0,y:0}),stickPointer=useRef<number|null>(null),acceleratorPointer=useRef<number|null>(null);
 // Each finger owns one input source. Steering must not cancel a held throttle.
 const syncInput=useCallback(()=>{world.current?.setInput({forward:acceleratorPointer.current===null?-stickInput.current.y/32:1,turn:stickInput.current.x/32,running:false});},[world]);
 const clearInput=useCallback(()=>{stickPointer.current=null;acceleratorPointer.current=null;stickInput.current={x:0,y:0};syncInput();},[syncInput]);
 const stopStick=(e:React.PointerEvent)=>{if(stickPointer.current!==e.pointerId)return;stickPointer.current=null;stickInput.current={x:0,y:0};setStick({x:0,y:0});syncInput();};
 const stopAccelerator=(e:React.PointerEvent)=>{if(acceleratorPointer.current!==e.pointerId)return;acceleratorPointer.current=null;syncInput();};
 useEffect(()=>{clearInput();setStick({x:0,y:0});const reset=()=>{clearInput();setStick({x:0,y:0});};const visibility=()=>{if(document.hidden)reset();};window.addEventListener('blur',reset);document.addEventListener('visibilitychange',visibility);return()=>{clearInput();window.removeEventListener('blur',reset);document.removeEventListener('visibilitychange',visibility);};},[driving,clearInput]);
 return <div className="touch-controls">
 <div className="joystick" role="slider" aria-label={driving?'Steer and drive':'Move character'} aria-valuemin={-1} aria-valuemax={1} aria-valuenow={-stick.y/32} tabIndex={0}
 onPointerDown={e=>{if(stickPointer.current!==null)return;stickPointer.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);origin.current={x:e.clientX,y:e.clientY};}}
 onPointerMove={e=>{if(stickPointer.current!==e.pointerId||!e.currentTarget.hasPointerCapture(e.pointerId))return;let x=e.clientX-origin.current.x,y=e.clientY-origin.current.y;const length=Math.hypot(x,y);if(length>32){x=x/length*32;y=y/length*32;}stickInput.current={x,y};setStick({x,y});syncInput();}}
 onPointerUp={stopStick} onPointerCancel={stopStick} onLostPointerCapture={stopStick}><span className="joystick-cross"/><span className="joystick-stick" style={{transform:`translate(${stick.x}px,${stick.y}px)`}}/></div>
 <div className="touch-actions"><button className="touch-small" aria-label={driving?'Exit pickup':'Enter pickup'} onClick={onVehicle}>{driving?<Footprints/>:<Truck/>}</button><button className="touch-interact" disabled={!canInteract} onClick={onInteract}><Hand/><span>Interact</span></button>{driving&&<button className="touch-small" aria-label="Accelerate" onPointerDown={e=>{if(acceleratorPointer.current!==null)return;acceleratorPointer.current=e.pointerId;e.currentTarget.setPointerCapture(e.pointerId);syncInput();}} onPointerUp={stopAccelerator} onPointerCancel={stopAccelerator} onLostPointerCapture={stopAccelerator}><ArrowUp/></button>}</div>
 </div>;
}
