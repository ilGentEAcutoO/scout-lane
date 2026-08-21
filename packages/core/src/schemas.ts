import { z } from "zod";
import { LIMITS, STAGES } from "./limits";
import { ROLES } from "./rbac";

export class ValidationError extends Error {
  readonly code = "invalid_body";
  constructor() {
    super("invalid_body");
    this.name = "ValidationError";
  }
}

export function parseBody<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ValidationError();
  return parsed.data;
}

export const usernameSchema = z
  .string()
  .trim()
  .min(LIMITS.usernameMin)
  .max(LIMITS.usernameMax)
  .regex(/^[a-z0-9._-]+$/i);

export const passwordSchema = z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax);

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(LIMITS.passwordMax),
});

export const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  role: z.enum(ROLES).default("member"),
});

export const calendarEmailSchema = z
  .string()
  .email()
  .max(LIMITS.emailMax)
  .optional()
  .or(z.literal(""));

export const patchUserSchema = z
  .object({
    role: z.enum(ROLES).optional(),
    disabled: z.boolean().optional(),
    password: passwordSchema.optional(),
    calendarEmail: calendarEmailSchema,
  })
  .refine(
    (v) =>
      v.role !== undefined ||
      v.disabled !== undefined ||
      v.password !== undefined ||
      v.calendarEmail !== undefined,
  );

export const CALENDAR_MODES = ["share", "personal", "both"] as const;

export const calendarSettingsSchema = z.object({
  mode: z.enum(CALENDAR_MODES),
  shareEmails: z.string().max(4000).optional().or(z.literal("")),
});

export const AI_PROVIDERS = ["glm", "claude", "openai", "gemini"] as const;
export const AI_KEY_SOURCES = ["stored", "secret"] as const;

export const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDERS).optional(),
  keys: z.partialRecord(z.enum(AI_PROVIDERS), z.string().max(512)).optional(),
});

/** Public GET shape — never includes ciphertext or plaintext keys. */
export const aiStatusSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  providers: z.array(
    z.object({
      id: z.enum(AI_PROVIDERS),
      label: z.string(),
      hint: z.string(),
      keyFrom: z.string().url(),
      configured: z.boolean(),
      source: z.enum(AI_KEY_SOURCES).nullable(),
    }),
  ),
});

export const SOURCE_GROUPS = ["thai_code", "community", "apify_web", "linkedin", "job_boards"] as const;
export const SOURCE_MODES = ["self", "shop", "link", "off"] as const;

export const sourceModesSchema = z.object({
  modes: z.partialRecord(z.enum(SOURCE_GROUPS), z.enum(SOURCE_MODES)),
  shopKey: z.string().max(256).optional(),
});

export const tokenNameSchema = z.object({
  name: z.string().trim().min(LIMITS.tokenNameMin).max(LIMITS.tokenNameMax).default("mcp"),
});

export const jobSchema = z.object({
  title: z.string().trim().min(LIMITS.jobTitleMin).max(LIMITS.jobTitleMax),
  description: z.string().trim().min(LIMITS.jobDescMin).max(LIMITS.jobDescMax),
  notes: z.string().trim().max(LIMITS.jdMax).optional(),
});

export const jobGenerateSchema = z.object({
  title: z.string().trim().min(LIMITS.jobTitleMin).max(LIMITS.jobTitleMax),
  notes: z.string().trim().min(LIMITS.jdMin).max(LIMITS.jdMax),
  jobId: z.string().uuid().optional(),
});

export const jobPatchSchema = z.object({
  title: z.string().trim().min(LIMITS.jobTitleMin).max(LIMITS.jobTitleMax).optional(),
  description: z.string().trim().min(LIMITS.jobDescMin).max(LIMITS.jobDescMax).optional(),
  notes: z.string().trim().max(LIMITS.jdMax).optional(),
});

export const jobListQuerySchema = z.object({
  q: z.string().trim().max(80).default(""),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});

export const candidateListQuerySchema = z.object({
  q: z.string().trim().max(80).default(""),
  stage: z.string().trim().max(40).optional(),
  source: z.string().trim().max(LIMITS.sourceMax).optional(),
  jobId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(5).max(200).default(20),
});

export const SCOUT_ORIGINS = ["any", "thai", "foreign"] as const;

export const scoutSearchSchema = z.object({
  jobId: z.string().uuid().optional(),
  title: z.string().trim().min(LIMITS.jobTitleMin).max(LIMITS.jobTitleMax).optional(),
  jd: z.string().trim().min(LIMITS.jdMin).max(LIMITS.jdMax),
  origin: z.enum(SCOUT_ORIGINS).default("thai"),
  modes: z.partialRecord(z.enum(SOURCE_GROUPS), z.enum(SOURCE_MODES)).optional(),
});

export const approveSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(LIMITS.approveIdsMax),
});

export const candidateCreateSchema = z.object({
  displayName: z.string().trim().min(LIMITS.candidateNameMin).max(LIMITS.candidateNameMax),
  email: z.string().email().max(LIMITS.emailMax).optional().or(z.literal("")),
  phone: z.string().max(LIMITS.phoneMax).optional(),
  source: z.string().trim().min(LIMITS.sourceMin).max(LIMITS.sourceMax).default("manual"),
  jobId: z.string().uuid().optional(),
  profileUrl: z
    .string()
    .url()
    .max(LIMITS.profileUrlMax)
    .refine((v) => !v || v.startsWith("https://"), "https_only")
    .optional()
    .or(z.literal("")),
});

export const candidatePatchSchema = z.object({
  displayName: z.string().trim().min(LIMITS.candidateNameMin).max(LIMITS.candidateNameMax).optional(),
  email: z.string().email().max(LIMITS.emailMax).optional().or(z.literal("")),
  phone: z.string().max(LIMITS.phoneMax).optional(),
  stage: z.enum(STAGES).optional(),
  notes: z.string().max(LIMITS.notesMax).optional(),
});

export const screenFieldsSchema = z.object({
  jobId: z.string().uuid(),
  name: z.string().trim().max(LIMITS.candidateNameMax).optional().or(z.literal("")),
  email: z.string().email().max(LIMITS.emailMax).optional().or(z.literal("")),
  text: z.string().max(LIMITS.resumeTextMax).optional().or(z.literal("")),
});

export const interviewSchema = z.object({
  candidateId: z.string().uuid(),
  startsAt: z.string().min(10).max(40),
  minutes: z.number().int().min(LIMITS.interviewMinutesMin).max(LIMITS.interviewMinutesMax).default(45),
  interviewerId: z.string().uuid().optional(),
});

export const interviewPatchSchema = z
  .object({
    candidateId: z.string().uuid().optional(),
    startsAt: z.string().min(10).max(40).optional(),
    minutes: z.number().int().min(LIMITS.interviewMinutesMin).max(LIMITS.interviewMinutesMax).optional(),
    interviewerId: z.union([z.string().uuid(), z.literal("")]).optional(),
  })
  .refine(
    (v) =>
      v.candidateId !== undefined ||
      v.startsAt !== undefined ||
      v.minutes !== undefined ||
      v.interviewerId !== undefined,
    { message: "empty_patch" },
  );

export const PROMPT_KEYS = [
  "prompt.job_draft",
  "prompt.scout_query",
  "prompt.scout_rank",
  "prompt.screen",
  "prompt.interview_pack",
] as const;

export type PromptKey = (typeof PROMPT_KEYS)[number];

export const promptSaveSchema = z.object({
  key: z.enum(PROMPT_KEYS),
  value: z.string().min(LIMITS.promptMin).max(LIMITS.promptMax),
});

export const uuidSchema = z.string().uuid();

export const stageQuerySchema = z.enum(STAGES);
