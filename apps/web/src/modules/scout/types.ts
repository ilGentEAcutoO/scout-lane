export type SourceId =
  | "github"
  | "github_repos"
  | "huggingface"
  | "npm"
  | "gitlab"
  | "devto"
  | "devhub"
  | "hn"
  | "reddit"
  | "stackoverflow"
  | "crates"
  | "pypi"
  | "rubygems"
  | "github_th"
  | "hf_spaces"
  | "github_bkk"
  | "github_langchain"
  | "gitlab_projects"
  | "stack_ai"
  | "stack_ds"
  | "packagist"
  | "hex"
  | "pubdev"
  | "openvsx"
  | "lobsters"
  | "hf_forum"
  | "openai_forum"
  | "dblp"
  | "s2"
  | "openalex"
  | "linkedin"
  | "facebook"
  | "jobsdb"
  | "jobthai"
  | "jobbkk"
  | "meetup"
  | "wellfound"
  | "x"
  | "apify_web";

export type SourceStatus = "live" | "needs_authorization" | "inbound_only";

export type CandidateHit = {
  source: SourceId;
  externalId: string;
  displayName: string;
  headline: string;
  /** Required public profile URL. Hits without https:// never enter the shortlist. */
  profileUrl: string;
  location: string | null;
  kind?: "person" | "org" | "package";
  portfolioUrl?: string;
};

export type SourceAdapter = {
  id: SourceId;
  status: SourceStatus;
  search(query: string, env: Env): Promise<CandidateHit[]>;
};
