import {ArrowRight,Backpack,Factory,MapPin,Route} from 'lucide-react';
import {PLACES,RESOURCE_NAMES,type GameState,type PlaceId} from '../../shared/types';
import {RECIPES,RESOURCE_UNITS} from '../../shared/economy-rules';
import {resourceIcons} from './Icons';

export type RawMaterial='crude'|'ore'|'timber';
const MATERIALS={
 crude:{site:'oilfield',business:'refinery',description:'Search North Ridge with your scanner. Read the signal, find the underground deposit and extract crude oil.',utility:'Petrol keeps your pickup running. Refine a load before a long delivery.'},
 ore:{site:'quarry',business:'foundry',description:'Mine the exposed iron seam at Stonecut Quarry. Bring your pickup when you need to carry a larger load.',utility:'Steel is a construction material. Save it for your own refinery, or sell it at the foundry.'},
 timber:{site:'forest',business:'sawmill',description:'Gather timber in Pinewood and take it to Imani at the sawmill.',utility:'Planks are needed to construct your own facility. Process timber before building.'},
} as const;

export function MaterialDetails({resource,state,near,onRoute,onWork}:{resource:RawMaterial;state:GameState;near:PlaceId|null;onRoute:(place:PlaceId)=>void;onWork:(place:PlaceId)=>void}){
 const detail=MATERIALS[resource],recipe=RECIPES[resource],Icon=resourceIcons[resource],ProductIcon=resourceIcons[recipe.output];
 const site=PLACES.find(p=>p.id===detail.site)!,business=PLACES.find(p=>p.id===detail.business)!;
 const amount=state.player.inventory[resource],live=state.mode==='live',fee=live?state.live?.processingFee:recipe.fee;
 return <div className="panel-body material-details">
  <div className={'resource-hero '+resource}><Icon size={56}/><div><span className="eyebrow">YOUR MATERIAL</span><h3>{RESOURCE_NAMES[resource]}</h3><span>{amount} {RESOURCE_UNITS[resource]} in cargo</span></div></div>
  <p className="muted">{detail.description}</p>
  <div className="material-route"><MapPin size={19}/><div><small>GATHER AT</small><strong>{site.name}</strong></div><button className="button secondary" onClick={()=>onRoute(detail.site)}><Route size={16}/>Track route</button></div>
  {near===detail.site&&<button className="button primary full" onClick={()=>onWork(detail.site)}><Icon size={18}/>{resource==='crude'?'Open prospecting tools':resource==='ore'?'Work the ore seam':'Gather timber'}<ArrowRight size={16}/></button>}
  <div className="material-recipe"><span><Icon size={23}/>{recipe.input} {RESOURCE_NAMES[resource]}</span><ArrowRight size={19}/><span><ProductIcon size={23}/>{recipe.yield} {RESOURCE_NAMES[recipe.output]}</span></div>
  <p className="muted">{detail.utility}</p>
  <div className="trade-line"><span>Processing fee / batch</span><b>{fee===undefined?'—':fee.toLocaleString('en-US',{maximumFractionDigits:6})} {live?'NEAR':'CR'}</b></div>
  <button className="button secondary full" onClick={()=>onRoute(detail.business)}><Factory size={18}/>Track {business.name}<ArrowRight size={16}/></button>
  <div className="note"><Backpack size={18}/><p>Use the backpack to see all six materials and products. These shortcuts show where to gather and use each raw material.</p></div>
 </div>;
}
