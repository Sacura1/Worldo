import {PLACES,type PlaceId,type Vec2} from '../../shared/types';
export function Map({position,heading,waypoint,large=false,onSelect,depositPosition}:{position:Vec2;heading:number;waypoint:PlaceId|null;large?:boolean;onSelect?:(id:PlaceId)=>void;depositPosition?:Vec2}){
 const xy=(n:number)=>(n+110)/220*300;
 const destination=waypoint==='oilfield'&&depositPosition?depositPosition:PLACES.find(p=>p.id===waypoint)?.position;
 return <svg className={large?'world-map large':'world-map'} viewBox="0 0 300 300" aria-label="Map of Lowland">
 <defs><pattern id={large?'grid-large':'grid-small'} width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#64705a" strokeWidth=".45"/></pattern></defs>
 <rect width="300" height="300" fill="#3c4936"/><path d="M8 4Q90 30 60 100T102 196T85 300H0V0" fill="#4c5b3d"/><path d="M270 0Q210 84 240 155T213 300H300V0" fill="#62634d"/><path d="M0 230Q70 191 140 233T300 210" stroke="#647c7a" strokeWidth="10" fill="none"/>
 <rect width="300" height="300" fill={`url(#${large?'grid-large':'grid-small'})`}/>
 <g stroke="#a69f83" strokeWidth="5" fill="none"><path d="M150 37V235M60 126H249M150 205H251M95 78L60 126M184 61L150 126"/></g><g stroke="#d1c8aa" strokeWidth="1" fill="none"><path d="M150 37V235M60 126H249M150 205H251"/></g>
 {PLACES.map(place=><g key={place.id} className={large?'map-marker':''} role={large?'button':undefined} tabIndex={large?0:undefined} aria-label={large?`Navigate to ${place.name}`:undefined} onClick={()=>onSelect?.(place.id)} onKeyDown={e=>{if(e.key==='Enter')onSelect?.(place.id);}} transform={`translate(${xy(place.position.x)},${xy(place.position.z)})`}>
 <circle r={large?13:6} fill={waypoint===place.id?'#efb652':'#d2c8a9'} stroke="#30372d" strokeWidth="2"/>{large&&<><text y="4" textAnchor="middle" fill="#30372d" fontSize="12">{PLACES.indexOf(place)+1}</text><text y="26" textAnchor="middle" fill="#fff4da" fontSize="9">{place.name}</text></>}
 </g>)}
 {destination&&<path d={`M${xy(position.x)} ${xy(position.z)}L${xy(destination.x)} ${xy(destination.z)}`} stroke="#efb652" strokeDasharray="3 4" strokeWidth="1.5"/>}
 {depositPosition&&<g transform={`translate(${xy(depositPosition.x)},${xy(depositPosition.z)})`} aria-label="Discovered oil deposit"><title>Discovered oil deposit</title><circle r={large?7:4} fill="#243024" stroke="#efb652" strokeWidth="2"/><path d="M0 -4V4M-4 0H4" stroke="#efb652" strokeWidth="1"/>{large&&<text x="10" y="3" fill="#efb652" fontSize="8">Oil deposit</text>}</g>}
 <g transform={`translate(${xy(position.x)},${xy(position.z)}) rotate(${-heading*180/Math.PI})`}><circle r="10" fill="#efb652" opacity=".18"/><path d="M0 -7L5 6L0 3L-5 6Z" fill="#fff5d8" stroke="#32382e" strokeWidth="1"/></g>
 <text x="150" y="18" textAnchor="middle" fill="#f3e6c9" fontSize="11">N</text>
 <text x="285" y="154" textAnchor="middle" fill="#f3e6c9" fontSize="10">E</text><text x="150" y="290" textAnchor="middle" fill="#f3e6c9" fontSize="10">S</text><text x="15" y="154" textAnchor="middle" fill="#f3e6c9" fontSize="10">W</text>
 </svg>;
}
