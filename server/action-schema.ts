import {z} from 'zod';
const resource=z.enum(['crude','ore','timber','petrol','steel','planks']);
const raw=z.enum(['crude','ore','timber']);
const place=z.enum(['depot','refinery','sawmill','foundry','oilfield','quarry','forest','plot']);
const quantity=z.number().int().min(1).max(40);
const simple=(type:'enterVehicle'|'exitVehicle'|'survey'|'scanner'|'refuel'|'rest'|'build'|'advance')=>z.object({type:z.literal(type)}).strict();
export const actionSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('move'),x:z.number().finite(),z:z.number().finite(),heading:z.number().finite(),driving:z.boolean()}).strict(),
 simple('enterVehicle'),simple('exitVehicle'),simple('survey'),simple('scanner'),simple('refuel'),simple('rest'),simple('build'),simple('advance'),
 z.object({type:z.literal('gather'),resource:raw}).strict(),
 z.object({type:z.literal('trade'),merchant:place,resource,quantity,side:z.enum(['buy','sell'])}).strict(),
 z.object({type:z.literal('process'),resource:raw,quantity}).strict()
]);
