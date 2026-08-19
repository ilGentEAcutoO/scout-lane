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

export const tokenNameSchema = z.object({
  name: z.string().trim().min(LIMITS.tokenNameMin).max(LIMITS.tokenNameMax).default("mcp"),
});

export const jobSchema = z.object({
  title: z.string().trim().min(LIMITS.jobTitleMin).max(LIMITS.jobTitleMax),
  description: z.string().trim().min(LIMITS.jobDescMin).max(LIMITS.jobDescMax),
});

export const SCOUT_ORIGINS = ["any", "thai", "foreign"] as const;

export const scoutSearchSchema = z.object({
  jobId: z.string().uuid().optional(),
  title: z.string().trim().min(LIMITS.jobTitleMin).max(LIMITS.jobTitleMax).optional(),
  jd: z.string().trim().min(LIMITS.jdMin).max(LIMITS.jdMax),
  origin: z.enum(SCOUT_ORIGINS).default("thai"),
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
  name: z.string().trim().min(LIMITS.candidateNameMin).max(LIMITS.candidateNameMax),
  email: z.string().email().max(LIMITS.emailMax).optional().or(z.literal("")),
  text: z.string().max(LIMITS.resumeTextMax).optional().or(z.literal("")),
});

export const interviewSchema = z.object({
  candidateId: z.string().uuid(),
  startsAt: z.string().min(10).max(40),
  minutes: z.number().int().min(LIMITS.interviewMinutesMin).max(LIMITS.interviewMinutesMax).default(45),
  interviewerId: z.string().uuid().optional(),
});

export const PROMPT_KEYS = [
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
