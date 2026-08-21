/** Single source of truth. UI maxlength and API/MCP schemas must import these. */
export const LIMITS = {
  usernameMin: 2,
  usernameMax: 32,
  passwordMin: 10,
  passwordMax: 200,
  tokenNameMin: 1,
  tokenNameMax: 80,
  jobTitleMin: 2,
  jobTitleMax: 160,
  jobDescMin: 10,
  jobDescMax: 12_000,
  candidateNameMin: 1,
  candidateNameMax: 160,
  emailMax: 200,
  phoneMax: 40,
  sourceMin: 1,
  sourceMax: 40,
  profileUrlMax: 400,
  notesMax: 4_000,
  promptMin: 10,
  promptMax: 8_000,
  jdMin: 10,
  jdMax: 12_000,
  resumeTextMax: 20_000,
  approveIdsMax: 120,
  interviewMinutesMin: 15,
  interviewMinutesMax: 180,
  uploadBytesMax: 5 * 1024 * 1024,
} as const;

/** Hire path. `rejected` is a drop status outside this order, not a last step. */
export const PIPELINE = [
  "applied",
  "screening",
  "prescreen",
  "interview",
  "offer",
  "hired",
] as const;

export const STAGES = [
  "applied",
  "screening",
  "prescreen",
  "interview",
  "offer",
  "hired",
  "rejected",
] as const;

export type Stage = (typeof STAGES)[number];
