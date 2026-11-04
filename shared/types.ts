export type Resource = 'crude'|'ore'|'timber'|'petrol'|'steel'|'planks';
export type PlaceId = 'depot'|'refinery'|'sawmill'|'foundry'|'oilfield'|'quarry'|'forest'|'plot';
export type Vec2 = {x:number;z:number};
export interface WorldInteraction {kind:'door'|'npc'|'fuel';id:string;label:string;position:Vec2;place?:PlaceId;npcId?:string;radius?:number;}
export interface Player {id:string; name:string; position:Vec2; heading:number; driving:boolean; fuel:number; energy:number; scanner:boolean; balance:number; inventory:Record<Resource,number>; facility:boolean; discovered:boolean; xp:number;scanSignal?:number;scanHint?:string;depositPosition?:Vec2;}
export interface Merchant {id:PlaceId; name:string; budget:number; stock:Record<Resource,number>;}
export interface Activity {id:string; text:string; at:number;}
export interface LiveRules {accountId:string;balanceYocto:string;scannerCost:number;processingFee:number;build:{steel:number;planks:number;credits:number};ownedRecipes:('crude'|'ore'|'timber')[];pendingOracle:boolean;receipt?:{hash:string;explorerUrl:string};}
export interface GameState {player:Player; merchants:Merchant[]; day:number; revision:number; activities:Activity[]; mode:'demo'|'live'; truckPosition?:Vec2; truckHeading?:number; doors?:Record<string,boolean>; deposits?:Record<'crude'|'ore'|'timber',number>; production?:{fuelConsumed:number;materialsUsed:number};live?:LiveRules;}
export type GameAction = {type:'move';x:number;z:number;heading:number;driving:boolean}|{type:'toggleDoor';doorId:string}|{type:'enterVehicle'}|{type:'exitVehicle'}|{type:'survey'}|{type:'gather';resource:'crude'|'ore'|'timber'}|{type:'trade';merchant:PlaceId;resource:Resource;quantity:number;side:'buy'|'sell'}|{type:'process';resource:'crude'|'ore'|'timber';quantity:number}|{type:'scanner'}|{type:'refuel'}|{type:'rest'}|{type:'build'}|{type:'advance'};
export const RESOURCE_NAMES:Record<Resource,string>={crude:'Crude oil',ore:'Iron ore',timber:'Timber',petrol:'Petrol',steel:'Steel',planks:'Planks'};
export const PLACES:{id:PlaceId;name:string;position:Vec2;kind:'business'|'resource'|'plot'}[]=[
 {id:'depot',name:'Supply depot',position:{x:0,z:12},kind:'business'},
 {id:'refinery',name:'Worldo Refinery',position:{x:45,z:-20},kind:'business'},
 {id:'sawmill',name:'Pine & Co. Sawmill',position:{x:-40,z:-18},kind:'business'},
 {id:'foundry',name:'Eastbank Foundry',position:{x:37,z:40},kind:'business'},
 {id:'oilfield',name:'North ridge',position:{x:25,z:-65},kind:'resource'},
 {id:'quarry',name:'Stonecut Quarry',position:{x:68,z:35},kind:'resource'},
 {id:'forest',name:'Pinewood',position:{x:-62,z:-55},kind:'resource'},
 {id:'plot',name:'Riverside plot',position:{x:-35,z:38},kind:'plot'}
];
export const START_POSITION:Vec2={x:0,z:23};
export const TRUCK_POSITION:Vec2={x:8,z:24};
export const emptyInventory=():Record<Resource,number>=>({crude:0,ore:0,timber:0,petrol:0,steel:0,planks:0});
