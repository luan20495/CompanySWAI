import {mkdir,readFile,writeFile} from "node:fs/promises";
import {dirname} from "node:path";
import {z} from "zod";
import type {RetrospectiveValue} from "./retrospective.js";

const Experience=z.object({
 lesson:z.string().min(1),projects:z.array(z.string()).default([]),observations:z.number().int().nonnegative(),
 status:z.enum(["CANDIDATE","VALIDATED"]),updatedAt:z.string().datetime()
});
const ExperienceFile=z.object({version:z.literal(1),items:z.array(Experience)});
export type ExperienceValue=z.infer<typeof Experience>;

export class CompanyExperienceStore{
 constructor(private path=".companyswai/company-experience.json"){}
 private async read(){
  try{return ExperienceFile.parse(JSON.parse(await readFile(this.path,"utf8")));}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {version:1 as const,items:[]};throw error;}
 }
 async observe(retro:RetrospectiveValue){
  const file=await this.read();
  for(const lesson of retro.lessons){
   if(/No systemic execution issue|completed without a detected/i.test(lesson))continue;
   let item=file.items.find(x=>x.lesson===lesson);
   if(!item){item={lesson,projects:[],observations:0,status:"CANDIDATE",updatedAt:new Date().toISOString()};file.items.push(item);}
   item.observations++;
   if(!item.projects.includes(retro.projectId))item.projects.push(retro.projectId);
   if(item.projects.length>=2)item.status="VALIDATED";
   item.updatedAt=new Date().toISOString();
  }
  await mkdir(dirname(this.path),{recursive:true});await writeFile(this.path,JSON.stringify(file,null,2),"utf8");return file.items;
 }
 async validatedLessons(){return (await this.read()).items.filter(x=>x.status==="VALIDATED").map(x=>x.lesson);}
 async list(){return (await this.read()).items;}
}
