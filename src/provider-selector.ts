import type {ModelProvider} from "./provider.js";
import type {CapacityProfile,TaskDemand} from "./capacity.js";
import {eligible,estimateCost,routeTask} from "./capacity.js";
import {CapacityUnavailableError} from "./errors.js";

export type ProviderSelectionRequest={
 preferredProvider?:string;
 preferredModel?:string;
 demand:TaskDemand;
 exclude?:Array<{provider:string;model:string}>;
};

export type ProviderSelection={
 provider:ModelProvider;
 profile:CapacityProfile;
 estimatedCost?:number;
};

export type ProviderSelector=(request:ProviderSelectionRequest)=>ProviderSelection;
export type ProviderInstantiator=(provider:string,model:string)=>ModelProvider;

export function createCapacitySelector(profiles:CapacityProfile[],instantiate:ProviderInstantiator):ProviderSelector{
 return request=>{
  const excluded=new Set((request.exclude??[]).map(item=>item.provider+"\n"+item.model));
  const filtered=profiles.filter(profile=>
   !excluded.has(profile.provider+"\n"+profile.model)&&
   (!request.preferredProvider||profile.provider===request.preferredProvider)&&
   (!request.preferredModel||profile.model===request.preferredModel)
  );

  const selected=request.preferredProvider&&request.preferredModel
   ? filtered.find(profile=>eligible(profile,request.demand))
   : routeTask(filtered,request.demand);

  if(!selected){
   const preference=request.preferredProvider?request.preferredProvider+"/"+request.preferredModel:"automatic routing";
   throw new CapacityUnavailableError("No eligible provider capacity for "+preference);
  }
  return {
   provider:instantiate(selected.provider,selected.model),
   profile:selected,
   estimatedCost:estimateCost(selected,request.demand)
  };
 };
}
