export const PLACEHOLDER_NAME = "ผู้สมัครจากเรซูเม่";

export type ContactGap = "name" | "email";

export type ResumeContact = {
  name: string;
  email: string;
  phone: string;
  missing: ContactGap[];
};

function missingOf(name: string, email: string): ContactGap[] {
  const missing: ContactGap[] = [];
  if (!name || name === PLACEHOLDER_NAME) missing.push("name");
  if (!email || !email.includes("@")) missing.push("email");
  return missing;
}

export function extractResumeContact(text: string): ResumeContact {
  const raw = String(text || "").replace(/\u0000/g, " ").slice(0, 6000);
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? "";
  const phoneHit = raw.match(/(?:\+66|0)(?:[\s.-]?\d){8,10}/);
  const phone = phoneHit ? phoneHit[0].replace(/[^\d+]/g, "") : "";

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  let name = "";
  for (const line of lines.slice(0, 8)) {
    if (/@/.test(line) || /https?:/i.test(line) || /\d{6,}/.test(line)) continue;
    if (/^(resume|curriculum|cv|profile|objective|summary|experience|education|skills)/i.test(line)) continue;
    const cleaned = line.replace(/[|•·,]/g, " ").replace(/\s+/g, " ").trim();
    if (cleaned.length < 2 || cleaned.length > 80) continue;
    if ((cleaned.match(/[A-Za-zก-๙]/g) || []).length < 2) continue;
    name = cleaned.slice(0, 160);
    break;
  }
  return {
    name: name || PLACEHOLDER_NAME,
    email,
    phone,
    missing: missingOf(name, email),
  };
}

export function mergeResumeContact(
  heuristic: ResumeContact,
  model?: { name?: string | undefined; email?: string | undefined; phone?: string | undefined },
): ResumeContact {
  const fromModel = (model?.name || "").trim().slice(0, 160);
  const name =
    heuristic.missing.includes("name") && fromModel && fromModel !== PLACEHOLDER_NAME
      ? fromModel
      : heuristic.name;
  const emailRaw = heuristic.email || (model?.email || "").trim().toLowerCase();
  const email = emailRaw.includes("@") ? emailRaw : "";
  const phone = heuristic.phone || (model?.phone || "").replace(/[^\d+]/g, "");
  return { name: name || PLACEHOLDER_NAME, email, phone, missing: missingOf(name, email) };
}

export function gapsOf(name?: string | null, email?: string | null): ContactGap[] {
  return missingOf(String(name || ""), String(email || ""));
}

export function preferStoredContact(
  stored: {
    displayName?: string | null | undefined;
    email?: string | null | undefined;
    phone?: string | null | undefined;
  },
  next: ResumeContact,
): ResumeContact {
  const storedName = (stored.displayName || "").trim();
  const name = storedName && storedName !== PLACEHOLDER_NAME ? storedName : next.name;
  const storedEmail = (stored.email || "").trim().toLowerCase();
  const email = storedEmail.includes("@") ? storedEmail : next.email;
  const storedPhone = (stored.phone || "").replace(/[^\d+]/g, "");
  const phone = storedPhone || next.phone;
  return { name: name || PLACEHOLDER_NAME, email, phone, missing: missingOf(name, email) };
}
