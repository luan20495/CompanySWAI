import {join} from "node:path";
import {FileApprovalStore} from "./approval-store.js";
import {FileArtifactStore,FileBlockerStore,FileDecisionStore,FileHandoffStore,FileReviewStore} from "./artifact-store.js";
import {FileCheckpointStore} from "./checkpoint-store.js";
import {CompanyExperienceStore} from "./company-experience.js";
import {FileExecutionStore} from "./execution-store.js";
import {ProjectMemoryStore} from "./project-memory.js";
import {FileRetrospectiveStore} from "./retrospective.js";
import {ResearchStore,TraceabilityStore} from "./traceability.js";
import {TelemetryStore} from "./telemetry.js";
import {RunStore} from "./run-store.js";
import {ReworkStore} from "./rework-store.js";

/** Every persisted store under one configurable state directory, so a run, its resume and its tests share one root. */
export class CompanyState{
 readonly executions:FileExecutionStore;readonly checkpoints:FileCheckpointStore;readonly approvals:FileApprovalStore;
 readonly memory:ProjectMemoryStore;readonly artifacts:FileArtifactStore;readonly decisions:FileDecisionStore;
 readonly handoffs:FileHandoffStore;readonly reviews:FileReviewStore;readonly blockers:FileBlockerStore;
 readonly retrospectives:FileRetrospectiveStore;readonly experience:CompanyExperienceStore;
 readonly traceability:TraceabilityStore;readonly research:ResearchStore;readonly telemetry:TelemetryStore;readonly runs:RunStore;readonly rework:ReworkStore;
 constructor(readonly root=".companyswai",companyRoot="company"){
  this.executions=new FileExecutionStore(join(root,"executions"));
  this.checkpoints=new FileCheckpointStore(join(root,"checkpoints"));
  this.approvals=new FileApprovalStore(join(root,"approvals"));
  this.memory=new ProjectMemoryStore(join(root,"projects"),companyRoot);
  this.artifacts=new FileArtifactStore(join(root,"artifacts"));
  this.decisions=new FileDecisionStore(join(root,"decisions"));
  this.handoffs=new FileHandoffStore(join(root,"handoffs"));
  this.reviews=new FileReviewStore(join(root,"reviews"));
  this.blockers=new FileBlockerStore(join(root,"blockers"));
  this.retrospectives=new FileRetrospectiveStore(join(root,"retrospectives"));
  this.experience=new CompanyExperienceStore(join(root,"company-experience.json"));
  this.traceability=new TraceabilityStore(join(root,"traceability"));
  this.research=new ResearchStore(join(root,"research"));
  this.telemetry=new TelemetryStore(join(root,"telemetry"));
  this.runs=new RunStore(join(root,"runs"));
  this.rework=new ReworkStore(join(root,"rework"));
 }
}
