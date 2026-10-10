import "dotenv/config";
import {CompanyState} from "./state.js";
import {registerSecret} from "./secrets.js";
import {loadRuntime} from "./runtime.js";
import {MarkdownAgentRegistry} from "./md-agent-loader.js";
import {SkillCatalog} from "./skill-selector.js";
import {dryRunSelector} from "./providers/dry-run.js";
import {runOperator} from "./operator-commands.js";

// Human/Claude-facing operator interface over the persisted CompanySWAI state. Usage: npm run operator -- help
const raw=process.argv.slice(2),at=raw.indexOf("--state-dir");
const stateDir=at>=0?raw[at+1]:".companyswai";
if(at>=0&&!stateDir)throw new Error("--state-dir needs a directory");
// Credentials from the environment are masked in every line this interface prints.
for(const [name,value] of Object.entries(process.env))if(/(API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name))registerSecret(value);

const result=await runOperator(raw,{
 state:new CompanyState(stateDir),
 // Only `resume` needs an engine; read commands never load providers.
 engine:async({dryRun,runtimePath})=>({
  selector:dryRun?dryRunSelector():(await loadRuntime(runtimePath??"config/providers.json")).selector,
  knownRoles:(await new MarkdownAgentRegistry().loadAll()).map(agent=>agent.id),
  knownSkills:(await new SkillCatalog().load()).map(skill=>skill.name)
 })
});
if(result.stdout)process.stdout.write(result.stdout);
if(result.stderr)process.stderr.write(result.stderr);
process.exitCode=result.code;
