import type {GameState, Merchant, PlaceId, Resource} from './types';

export const RESOURCE_UNITS:Record<Resource,string>={crude:'barrels',ore:'loads',timber:'logs',petrol:'cans',steel:'beams',planks:'bundles'};
export const BASE_PRICES:Record<Resource,number>={crude:3.2,ore:4,timber:2.4,petrol:10,steel:13,planks:8};
export const MERCHANT_GOODS:Partial<Record<PlaceId,Resource[]>>={depot:['petrol','steel','planks'],refinery:['crude','petrol'],foundry:['ore','steel'],sawmill:['timber','planks']};
export const RECIPES={crude:{output:'petrol',input:2,yield:1,fee:2,place:'refinery'},ore:{output:'steel',input:2,yield:1,fee:2,place:'foundry'},timber:{output:'planks',input:2,yield:1,fee:1,place:'sawmill'}} as const;
export const BUILD_COST={credits:60,steel:4,planks:6};
export const SCANNER_COST=12;
export const cargoUsed=(state:GameState)=>Object.values(state.player.inventory).reduce((a,b)=>a+b,0);
export const capacity=(state:GameState)=>state.player.driving?40:12;
export const cargoCapacity=capacity;
export const roundMoney=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
export function unitPrice(merchant:Merchant,resource:Resource,side:'buy'|'sell') {
  const scarcity=Math.max(.48,Math.min(1.8,1.4-merchant.stock[resource]/45));
  return roundMoney(BASE_PRICES[resource]*scarcity*(side==='sell'?.68:1));
}
export function quoteTrade(state:GameState,merchantId:PlaceId,resource:Resource,quantity:number,side:'buy'|'sell') {
  const merchant=state.merchants.find(m=>m.id===merchantId);
  if(!merchant) throw new Error('This business is not open.');
  if(!MERCHANT_GOODS[merchantId]?.includes(resource)) throw new Error('This business does not trade that resource.');
  if(!Number.isInteger(quantity)||quantity<1||quantity>40) throw new Error('Choose a quantity from 1 to 40.');
  const copy={...merchant,stock:{...merchant.stock}};
  let total=0;
  for(let i=0;i<quantity;i++) {total+=unitPrice(copy,resource,side);copy.stock[resource]+=side==='sell'?1:-1;}
  const reason=merchant.stock[resource]<8?'Low stock · stronger buying price':merchant.stock[resource]>28?'High stock · lower buying price':'Balanced stock · steady demand';
  return {unitPrice:unitPrice(merchant,resource,side),total:roundMoney(total),reason};
}
