import {MarkdownAgentRegistry} from "./md-agent-loader.js";
import {readFile} from "node:fs/promises";
import {ProjectBrief} from "./work-planner.js";
import {compileBriefToProjectPlan} from "./plan-compiler.js";

const agents=await new MarkdownAgentRegistry().loadAll();
if(agents.length!==11)throw new Error("Expected exactly 11 declared agents");
const brief=ProjectBrief.parse(JSON.parse(await readFile("examples/project-brief.json","utf8")));
const plan=await compileBriefToProjectPlan(brief);
const produced=new Set(agents.flatMap(a=>a.produces));
for(const agent of agents)for(const required of agent.requires)if(!produced.has(required))throw new Error("No agent produces required artifact "+required+" for "+agent.id);
console.log(JSON.stringify({status:"ok",agents:agents.map(a=>a.id),exampleTasks:plan.tasks.map(t=>t.id)},null,2));
