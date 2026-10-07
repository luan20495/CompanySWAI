export class CapacityUnavailableError extends Error{
 readonly code="CAPACITY_UNAVAILABLE";
 constructor(message="No eligible provider capacity"){super(message);this.name="CapacityUnavailableError";}
}
export class BudgetExceededError extends Error{
 readonly code="BUDGET_EXCEEDED";
 constructor(message:string){super(message);this.name="BudgetExceededError";}
}
