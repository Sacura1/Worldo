import type {Vec2} from './types';
import {findSafeVehicleExit} from './world-physics';

export interface Footprint {x:number;z:number;w:number;d:number;}
export interface TankFootprint {x:number;z:number;r:number;}
export type Collider=Footprint&{height?:number;rotation?:number;kind?:'npc'|'wall'|'prop'|'door';id?:string};

// Scene geometry, map roads and safe vehicle exits share one layout.
export const BUILDINGS={
 depot:{x:0,z:5,w:12,d:9},
 refinery:{x:50,z:-30,w:9,d:8},
 sawmill:{x:-44,z:-29,w:12,d:12},
 foundry:{x:40,z:49,w:12,d:10},
 westHouse:{x:-12,z:-6,w:6,d:7},
 eastHouse:{x:12,z:-6,w:6,d:7},
} as const;
export const TANKS={
 east:{x:61,z:-25,r:2.7},
 north:{x:61,z:-34,r:2.7},
 west:{x:43,z:-33,r:2.2},
} as const;
export const COUNTERS={depot:{x:-1.7,z:11.8,w:3,d:.9},refinery:{x:45,z:-20,w:3.5,d:.9}} as const;
export const WORLD_COLLIDERS:readonly Collider[]=[
 ...Object.values(BUILDINGS).map(({x,z,w,d})=>({x,z,w:w+.4,d:d+.4})),
 ...Object.values(TANKS).map(({x,z,r})=>({x,z,w:r*2,d:r*2})),
 ...Object.values(COUNTERS),
];
export const ROADS:readonly (readonly [number,number,number,number,number])[]=[
 [0,27,0,12,7],[0,18,37,40,6],[0,18,45,-20,7],[0,18,-40,-18,6],
 [45,-20,25,-65,5],[37,40,68,35,5],[-40,-18,-62,-55,4],[-35,38,0,23,4],
];
export const WALK_RADIUS=.32;
export const TRUCK_RADIUS=1.2;
export const WORLD_LIMIT=99;

export function collidesWithWorld(position:Vec2,radius:number,colliders:readonly Collider[]=WORLD_COLLIDERS):boolean {
 return colliders.some(c=>Math.abs(position.x-c.x)<c.w/2+radius&&Math.abs(position.z-c.z)<c.d/2+radius);
}

/** Try the doors first, then nearby front/rear positions. Never place a player inside a wall. */
export function findVehicleExit(position:Vec2,heading:number,colliders:readonly Collider[]=WORLD_COLLIDERS):Vec2|null {
 return findSafeVehicleExit(position,heading,colliders);
}
