import type {GameState,PlaceId,Vec2,WorldInteraction} from '../../shared/types';
import type {GameAudioFrame} from '../lib/game-audio';
export interface WorldInput {forward:number;turn:number;lookX:number;lookY:number;running:boolean;}
export interface WorldHandle {dispose():void;setState(state:GameState,options?:{preservePosition?:boolean}):void;setInput(input:Partial<WorldInput>):void;setPaused(paused:boolean):void;setQuality(quality:'low'|'high'|'auto'):void;setTranslator(translate:(message:string)=>string):void;}
export interface WorldOptions {onMove:(position:Vec2,heading:number,driving:boolean)=>void;onNear:(place:PlaceId|null)=>void;onInteraction?:(target:WorldInteraction|null)=>void;onPerformance?:(fps:number,drawCalls:number)=>void;onAudioFrame?:(frame:GameAudioFrame)=>void;onReady:()=>void;}
