/** App URLs in one place (query-param routes work in the static Mac-app build). */
const q = (s: string) => encodeURIComponent(s);
export const routes = {
  board: (workflowId: string) => `/workflows/board?id=${q(workflowId)}`,
  plan: (serviceTypeId: string, planId: string) => `/services/plan?st=${q(serviceTypeId)}&plan=${q(planId)}`,
  matrix: (serviceTypeId: string) => `/services/matrix?st=${q(serviceTypeId)}`,
};
