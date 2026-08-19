import type { SourceAdapter, SourceId } from "./types";

function blocked(id: SourceId): SourceAdapter {
  return {
    id,
    status: id === "jobsdb" || id === "jobthai" || id === "jobbkk" ? "inbound_only" : "needs_authorization",
    async search() {
      return [];
    },
  };
}

export const linkedinAdapter = blocked("linkedin");
export const facebookAdapter = blocked("facebook");
export const jobsdbAdapter = blocked("jobsdb");
export const jobthaiAdapter = blocked("jobthai");
export const jobbkkAdapter = blocked("jobbkk");
