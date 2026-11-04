import * as THREE from 'three';
import type {GameState, PlaceId} from '../../shared/types';
import {PLACES, START_POSITION, TRUCK_POSITION} from '../../shared/types';
import {createEnvironment,createCharacter,createTruck,disposeAssets} from './assets';
import {collidesWithWorld,WALK_RADIUS,TRUCK_RADIUS,WORLD_LIMIT} from '../../shared/world-layout';
import type {WorldHandle,WorldInput,WorldOptions} from './types';

/** Real-time rendering only. The server owns inventory, prices, time and resource awards. */
export function createWorld(container:HTMLElement,options:WorldOptions):WorldHandle {
 const scene=new THREE.Scene();scene.background=new THREE.Color('#b7c9cc');scene.fog=new THREE.Fog('#b7c9cc',72,215);
 const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
 renderer.setClearColor('#b7c9cc');renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.13;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
 renderer.domElement.setAttribute('aria-label','Lowland interactive 3D world');renderer.domElement.setAttribute('role','img');renderer.domElement.tabIndex=-1;renderer.domElement.style.cssText='display:block;width:100%;height:100%;touch-action:none;outline:none';container.appendChild(renderer.domElement);
 const camera=new THREE.PerspectiveCamera(58,1,.15,270);
 const hemi=new THREE.HemisphereLight('#e6eff0','#67674a',2.2);scene.add(hemi);
 const sun=new THREE.DirectionalLight('#ffefd2',3.1);sun.position.set(-35,55,25);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-38;sun.shadow.camera.right=38;sun.shadow.camera.top=38;sun.shadow.camera.bottom=-38;sun.shadow.camera.near=1;sun.shadow.camera.far=150;sun.shadow.normalBias=.035;sun.shadow.bias=-.00015;scene.add(sun,sun.target);
 const environment=createEnvironment();scene.add(environment.group);
 const character=createCharacter();scene.add(character.root);const truck=createTruck();scene.add(truck.root);truck.root.position.set(TRUCK_POSITION.x,0,TRUCK_POSITION.z);
 const workerShadow=new THREE.Mesh(new THREE.CircleGeometry(.5,20),new THREE.MeshBasicMaterial({color:'#222a20',transparent:true,opacity:.12,depthWrite:false}));workerShadow.rotation.x=-Math.PI/2;workerShadow.position.y=.04;scene.add(workerShadow);
 // This marker is created from a server-revealed discovery only, never the private deposit seed.
 const depositMarker=new THREE.Group();depositMarker.visible=false;
 const depositRing=new THREE.Mesh(new THREE.RingGeometry(.65,.83,40),new THREE.MeshBasicMaterial({color:'#e8b54e',side:THREE.DoubleSide,transparent:true,opacity:.85,depthWrite:false}));depositRing.rotation.x=-Math.PI/2;depositRing.position.y=.08;depositMarker.add(depositRing);
 const depositStake=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,1.8,8),new THREE.MeshStandardMaterial({color:'#c89a48',roughness:.8}));depositStake.position.y=.9;depositMarker.add(depositStake);
 const markerCanvas=document.createElement('canvas');markerCanvas.width=512;markerCanvas.height=128;const markerContext=markerCanvas.getContext('2d')!;markerContext.fillStyle='#e6b65a';markerContext.fillRect(0,0,512,128);markerContext.fillStyle='#283325';markerContext.font='bold 48px sans-serif';markerContext.textAlign='center';markerContext.textBaseline='middle';markerContext.fillText('OIL DEPOSIT',256,67);const markerTexture=new THREE.CanvasTexture(markerCanvas);markerTexture.colorSpace=THREE.SRGBColorSpace;
 const depositFlag=new THREE.Sprite(new THREE.SpriteMaterial({map:markerTexture,depthWrite:false}));depositFlag.position.set(.62,1.65,0);depositFlag.scale.set(1.3,.325,1);depositMarker.add(depositFlag);scene.add(depositMarker);
 // Ground-level haze softens the distant tree line without post-processing cost.
 const skyGeometry=new THREE.SphereGeometry(240,20,12);const skyMaterial=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{top:{value:new THREE.Color('#83b7ce')},bottom:{value:new THREE.Color('#d9e0d7')}},vertexShader:'varying vec3 vWorld; void main(){vWorld=(modelMatrix*vec4(position,1.0)).xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'varying vec3 vWorld;uniform vec3 top;uniform vec3 bottom;void main(){float h=clamp(normalize(vWorld+vec3(0.,22.,0.)).y,0.,1.);gl_FragColor=vec4(mix(bottom,top,pow(h,0.55)),1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'});const sky=new THREE.Mesh(skyGeometry,skyMaterial);sky.renderOrder=-1;scene.add(sky);
 let state:GameState|undefined,initialized=false,paused=true,hasStarted=false,disposed=false,contextLost=false,quality:'low'|'high'|'auto'='auto';
 let playerPosition=new THREE.Vector3(START_POSITION.x,0,START_POSITION.z),heading=0,driving=false,speed=0;
 const external:WorldInput={forward:0,turn:0,lookX:0,lookY:0,running:false};const keys=new Set<string>();
 let cameraYaw=0,cameraPitch=.03,orbitOffset=0,cameraDistance=5.8,walkCycle=0,near:PlaceId|null=null;
 let width=1,height=1,mobile=false,ratio=1.4,frame=0,last=performance.now(),lastSync=0,lastStats=performance.now(),statFrames=0,lowFrames=0,lastMoved=false;
 let lastSent=new THREE.Vector3(999,0,999),lastSentHeading=999;const goal=new THREE.Vector3(),desiredCamera=new THREE.Vector3(),lookTarget=new THREE.Vector3();
 const updateSize=()=>{width=Math.max(container.clientWidth,1);height=Math.max(container.clientHeight,1);mobile=width<700;camera.aspect=width/height;camera.fov=mobile?66:58;camera.updateProjectionMatrix();ratio=quality==='low'?1:Math.min(window.devicePixelRatio||1,mobile?1.3:1.6);renderer.setPixelRatio(ratio);renderer.setSize(width,height,false);};
 const resizeObserver=new ResizeObserver(updateSize);resizeObserver.observe(container);updateSize();
 const ignoreKeyboard=(target:EventTarget|null)=>target instanceof HTMLElement&&['INPUT','TEXTAREA','SELECT'].includes(target.tagName);
 const onKeyDown=(e:KeyboardEvent)=>{if(ignoreKeyboard(e.target))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)){if(!paused)e.preventDefault();keys.add(e.code);}};
 const onKeyUp=(e:KeyboardEvent)=>keys.delete(e.code);const clear=()=>{keys.clear();external.forward=external.turn=external.lookX=external.lookY=0;speed=0;};
 window.addEventListener('keydown',onKeyDown);window.addEventListener('keyup',onKeyUp);window.addEventListener('blur',clear);
 let pointer:{id:number;x:number;y:number}|null=null;
 const pointerDown=(e:PointerEvent)=>{if(paused||e.button>0)return;pointer={id:e.pointerId,x:e.clientX,y:e.clientY};renderer.domElement.setPointerCapture(e.pointerId);};
 const pointerMove=(e:PointerEvent)=>{if(!pointer||e.pointerId!==pointer.id||paused)return;orbitOffset-=(e.clientX-pointer.x)*.004;cameraPitch=THREE.MathUtils.clamp(cameraPitch+(e.clientY-pointer.y)*.0025,-.08,.65);pointer.x=e.clientX;pointer.y=e.clientY;};
 const pointerUp=(e:PointerEvent)=>{if(pointer?.id===e.pointerId)pointer=null;};const wheel=(e:WheelEvent)=>{if(paused)return;e.preventDefault();cameraDistance=THREE.MathUtils.clamp(cameraDistance+e.deltaY*.004,4.5,11);};
 renderer.domElement.addEventListener('pointerdown',pointerDown);renderer.domElement.addEventListener('pointermove',pointerMove);renderer.domElement.addEventListener('pointerup',pointerUp);renderer.domElement.addEventListener('pointercancel',pointerUp);renderer.domElement.addEventListener('wheel',wheel,{passive:false});
 const onContextLost=(e:Event)=>{e.preventDefault();contextLost=true;container.dataset.contextLost='true';};const onContextRestored=()=>{contextLost=false;delete container.dataset.contextLost;};renderer.domElement.addEventListener('webglcontextlost',onContextLost);renderer.domElement.addEventListener('webglcontextrestored',onContextRestored);
 function collision(x:number,z:number,radius:number){return collidesWithWorld({x,z},radius);}
 function nearPlace(){let closest:PlaceId|null=null,min=Infinity;for(const place of PLACES){const d=Math.hypot(playerPosition.x-place.position.x,playerPosition.z-place.position.z);if(d<(place.id==='oilfield'?30:10)&&d<min){min=d;closest=place.id;}}if(closest!==near){near=closest;options.onNear(near);}}
 function animate(now:number){
  if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min((now-last)/1000,.045);last=now;if(contextLost)return;
  const forward=paused?0:THREE.MathUtils.clamp(external.forward+(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),-1,1);
  const turn=paused?0:THREE.MathUtils.clamp(external.turn+(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0),-1,1);
  const running=external.running||keys.has('ShiftLeft')||keys.has('ShiftRight');let maxSpeed=driving?13:running?6:4.4;if(driving&&state&&state.player.fuel<=0)maxSpeed=0;
  const desiredSpeed=forward*maxSpeed*(forward<0?.5:1);speed=THREE.MathUtils.damp(speed,desiredSpeed,driving?2.6:10,dt);
  if(paused)speed=0;
  const turnRate=driving?1.65*Math.min(Math.abs(speed)/3,1):2.3;heading-=turn*turnRate*dt*(driving&&speed<-.2?-1:1);
  orbitOffset-=external.lookX*.003;cameraPitch=THREE.MathUtils.clamp(cameraPitch+external.lookY*.003,-.08,.65);external.lookX=external.lookY=0;
  const nextX=THREE.MathUtils.clamp(playerPosition.x-Math.sin(heading)*speed*dt,-WORLD_LIMIT,WORLD_LIMIT),nextZ=THREE.MathUtils.clamp(playerPosition.z-Math.cos(heading)*speed*dt,-WORLD_LIMIT,WORLD_LIMIT),r=driving?TRUCK_RADIUS:WALK_RADIUS;
  let moved=false;if(!collision(nextX,playerPosition.z,r)){moved||=Math.abs(nextX-playerPosition.x)>.0001;playerPosition.x=nextX;}else if(driving)speed*=.86;if(!collision(playerPosition.x,nextZ,r)){moved||=Math.abs(nextZ-playerPosition.z)>.0001;playerPosition.z=nextZ;}else if(driving)speed*=.86;
  character.root.visible=!driving;character.root.position.copy(playerPosition);character.root.rotation.y=heading;
  if(driving){truck.root.position.copy(playerPosition);truck.root.rotation.y=heading;truck.root.rotation.z=THREE.MathUtils.damp(truck.root.rotation.z,-turn*speed*.002,4,dt);for(const wheel of truck.wheels)wheel.rotation.x-=speed*dt/.44;}
  walkCycle+=Math.abs(speed)*dt*2.8;for(let i=0;i<character.limbs.length;i++){const phase=i<2?0:Math.PI;const side=i%2===0?1:-1;const amp=(i%2===0?.65:.45)*Math.min(Math.abs(speed)/4,1);character.limbs[i].rotation.x=THREE.MathUtils.damp(character.limbs[i].rotation.x,Math.sin(walkCycle+phase)*amp*side,12,dt);}character.root.position.y=driving?0:Math.abs(Math.sin(walkCycle))*Math.min(Math.abs(speed)/4,1)*.025;
  workerShadow.visible=!driving;workerShadow.position.x=playerPosition.x;workerShadow.position.z=playerPosition.z;
  // Follow camera eases independently of render frame rate; orbit slowly recentres in motion.
  if(!pointer&&Math.abs(speed)>.3)orbitOffset=THREE.MathUtils.damp(orbitOffset,0,1.2,dt);
  const targetYaw=heading+orbitOffset;cameraYaw+=Math.atan2(Math.sin(targetYaw-cameraYaw),Math.cos(targetYaw-cameraYaw))*(1-Math.exp(-5*dt));
  const distance=(driving?cameraDistance*1.6:cameraDistance)*(mobile?1.08:1);const heightOffset=driving?2.1:1.25;
  lookTarget.set(playerPosition.x,driving?1.2:1.25,playerPosition.z);desiredCamera.set(playerPosition.x+Math.sin(cameraYaw)*distance,lookTarget.y+heightOffset+cameraPitch*distance,playerPosition.z+Math.cos(cameraYaw)*distance);
  // Avoid putting the camera inside a workshop wall while walking past buildings.
  for(let t=1;t>.25;t-=.1){goal.copy(lookTarget).lerp(desiredCamera,t);if(!collision(goal.x,goal.z,.18)||goal.y>7){desiredCamera.copy(goal);break;}}
  if(!hasStarted){desiredCamera.set(-17+Math.sin(now*.000035)*3,13,42);lookTarget.set(25,2,-18);camera.position.lerp(desiredCamera,1-Math.exp(-1.8*dt));camera.lookAt(lookTarget);}else{camera.position.lerp(desiredCamera,1-Math.exp(-7*dt));camera.lookAt(lookTarget);}
  if(now-lastSync>200){lastSync=now;nearPlace();if(!paused&&(playerPosition.distanceToSquared(lastSent)>.001||Math.abs(heading-lastSentHeading)>.015||lastMoved!==moved)){options.onMove({x:playerPosition.x,z:playerPosition.z},heading,driving);lastSent.copy(playerPosition);lastSentHeading=heading;lastMoved=moved;}}
  sun.position.set(playerPosition.x-35,55,playerPosition.z+25);sun.target.position.set(playerPosition.x,0,playerPosition.z);
  renderer.render(scene,camera);statFrames++;
  if(now-lastStats>1800){const fps=Math.round(statFrames*1000/(now-lastStats));options.onPerformance?.(fps,renderer.info.render.calls);container.dataset.fps=String(fps);container.dataset.drawCalls=String(renderer.info.render.calls);container.dataset.triangles=String(renderer.info.render.triangles);container.dataset.playerX=playerPosition.x.toFixed(2);container.dataset.playerZ=playerPosition.z.toFixed(2);statFrames=0;lastStats=now;
   if(quality==='auto'){if(fps<28){lowFrames++;if(lowFrames>=2){ratio=Math.max(.8,ratio-.2);renderer.setPixelRatio(ratio);if(ratio<=1)renderer.shadowMap.enabled=false;lowFrames=0;}}else lowFrames=0;}
  }
 }
 camera.position.set(-17,13,42);camera.lookAt(25,2,-18);nearPlace();renderer.render(scene,camera);frame=requestAnimationFrame(animate);queueMicrotask(()=>{if(!disposed)options.onReady();});
 return {
  setState(next,options){
   const entering=next.player.driving!==driving;state=next;driving=next.player.driving;
   // A successful movement acknowledgement describes an earlier frame. Keep
   // predicting locally; rejected moves and other state changes still reconcile.
   if(!initialized||entering||(!options?.preservePosition&&Math.hypot(next.player.position.x-playerPosition.x,next.player.position.z-playerPosition.z)>4)){playerPosition.set(next.player.position.x,0,next.player.position.z);heading=next.player.heading;cameraYaw=heading;speed=0;initialized=true;}
   const parked=(next as GameState&{truckPosition?:{x:number;z:number}}).truckPosition;
   if(!driving&&parked){truck.root.position.set(parked.x,0,parked.z);truck.root.rotation.set(0,next.truckHeading??0,0);}
   truck.cargo.visible=Object.values(next.player.inventory).reduce((a,v)=>a+v,0)>0;environment.facility.visible=next.player.facility;depositMarker.visible=next.player.discovered&&!!next.player.depositPosition;if(next.player.depositPosition)depositMarker.position.set(next.player.depositPosition.x,0,next.player.depositPosition.z);nearPlace();
  },
  setInput(input){Object.assign(external,input);},
  setPaused(value){paused=value;if(value)clear();else hasStarted=true;},
  setQuality(value){quality=value;renderer.shadowMap.enabled=value!=='low';updateSize();},
  dispose(){
   if(disposed)return;disposed=true;cancelAnimationFrame(frame);resizeObserver.disconnect();window.removeEventListener('keydown',onKeyDown);window.removeEventListener('keyup',onKeyUp);window.removeEventListener('blur',clear);
   renderer.domElement.removeEventListener('pointerdown',pointerDown);renderer.domElement.removeEventListener('pointermove',pointerMove);renderer.domElement.removeEventListener('pointerup',pointerUp);renderer.domElement.removeEventListener('pointercancel',pointerUp);renderer.domElement.removeEventListener('wheel',wheel);renderer.domElement.removeEventListener('webglcontextlost',onContextLost);renderer.domElement.removeEventListener('webglcontextrestored',onContextRestored);
   const geos=new Set<THREE.BufferGeometry>(),mats=new Set<THREE.Material>(),texs=new Set<THREE.Texture>();scene.traverse(o=>{if(o instanceof THREE.Mesh){geos.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material]){mats.add(m);if((m as THREE.MeshStandardMaterial).map)texs.add((m as THREE.MeshStandardMaterial).map!);}}});geos.forEach(g=>g.dispose());texs.forEach(t=>t.dispose());mats.forEach(m=>m.dispose());markerTexture.dispose();depositFlag.material.dispose();disposeAssets();renderer.dispose();renderer.domElement.remove();
  }
 };
}
