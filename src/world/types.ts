import type {GameState,PlaceId,Vec2,WorldInteraction} from '../../shared/types';
export interface WorldInput {forward:number;turn:number;lookX:number;lookY:number;running:boolean;}
export interface WorldHandle {dispose():void;setState(state:GameState,options?:{preservePosition?:boolean}):void;setInput(input:Partial<WorldInput>):void;setPaused(paused:boolean):void;setQuality(quality:'low'|'high'|'auto'):void;}
export interface WorldOptions {onMove:(position:Vec2,heading:number,driving:boolean)=>void;onNear:(place:PlaceId|null)=>void;onInteraction?:(target:WorldInteraction|null)=>void;onPerformance?:(fps:number,drawCalls:number)=>void;onReady:()=>void;}
