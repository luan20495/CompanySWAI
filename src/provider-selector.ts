import type {ModelProvider} from "./provider.js";
import type {CapacityProfile,TaskDemand} from "./capacity.js";
import {eligible,routeTask} from "./capacity.js";

export type ProviderSelectionRequest={
 preferredProvider?:string;
 preferredModel?:string;
 demand:TaskDemand;
};

export type ProviderSelector=(request:ProviderSelectionRequest)=>ModelProvider;
export type ProviderInstantiator=(provider:string,model:string)=>ModelProvider;

export function createCapacitySelector(profiles:CapacityProfile[],instantiate:ProviderInstantiator):ProviderSelector{
 return request=>{
  const filtered=profiles.filter(profile=>
   (!request.preferredProvider||profile.provider===request.preferredProvider)&&
   (!request.preferredModel||profile.model===request.preferredModel)
  );

  const selected=request.preferredProvider&&request.preferredModel
   ? filtered.find(profile=>eligible(profile,request.demand))
   : routeTask(filtered,request.demand);

  if(!selected){
   const preference=request.preferredProvider?request.preferredProvider+"/"+request.preferredModel:"automatic routing";
   throw new Error("No eligible provider capacity for "+preference);
  }
  return instantiate(selected.provider,selected.model);
 };
}
