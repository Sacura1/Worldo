import {Droplets,Mountain,TreePine,Fuel,Layers,PanelTop,type LucideIcon} from 'lucide-react';
import type {Resource} from '../../shared/types';
export const resourceIcons:Record<Resource,LucideIcon>={crude:Droplets,ore:Mountain,timber:TreePine,petrol:Fuel,steel:Layers,planks:PanelTop};
export function NearIcon(){return <img className="near-icon" src="/brand/near.svg" alt="NEAR"/>;}
