# Scout Lane

[![License: PolyForm Noncommercial](https://img.shields.io/badge/license-PolyForm%20Noncommercial-4A6B5C)](LICENSE)

พื้นที่ทำงานสรรหา — หาคนจาก JD, คัดเรซูเม่, เลื่อนท่อ, นัดสัมภาษณ์ในตารางสัปดาห์

เปิดซอร์สให้ดูและศึกษาได้ภายใต้ [PolyForm Noncommercial 1.0.0](LICENSE). **ห้ามใช้ในธุรกิจ** — บริษัท เอเจนซี งานลูกค้า หรือท่อสรรหาในองค์กร ต้อง[ติดต่อเจ้าของแล้วจ่าย](LICENSE-COMMERCIAL.md) ไม่ว่าจะได้กำไรจากตัวซอฟต์แวร์หรือไม่. ไม่ใช้ MIT / Apache / AGPL เพราะสามอันนั้นอนุญาตใช้ในบริษัทฟรี.

```text
apps/web     HR UI + API   (port 8787)
apps/mcp     remote MCP    (port 8790)
packages/core   password hashing, users, PATs
```

## Architecture

หนึ่ง Worker ถือ UI + API. D1 เก็บงาน คน นัด. KV เก็บเซสชันและรีเฟรชโทเค็นปฏิทิน. R2 เก็บ PDF. Queue อ่านเรซูเม่ยาว. Durable Object ล็อกช่วงเวลาเพื่อกันนัดซ้อน — นี่คือแหล่งความจริงเรื่องชน แม้ Google ล้ม.

ค้นคน: API สาธารณะที่ถูกกฎหมาย (GitHub, Hugging Face, npm, GitLab, DevHub, HN, …) + ลิงก์ค้นทางการ (JobsDB People, JobThai, …). ผู้ให้บริการค้นข้อมูล (Apify) เป็นช่องสำรองเมื่อมี `APIFY_TOKEN` — ค้นเว็บสาธารณะ (รวม Kaggle / Speaker Deck / Codeberg) และ LinkedIn ดึงผ่านตัวค้นโปรไฟล์ที่อนุญาตเท่านั้น ไม่ดึงเอง ไม่ใช้คุกกี้ ไม่เปิดลิงก์ให้ HR. ไม่ดึง Facebook / บอร์ดสมัคร. แอดมินตั้งโหมดแหล่งได้ที่ Settings → แหล่งค้นคน. HR อนุมัติก่อนเข้าท่อ.

AI วิ่งผ่าน Cloudflare AI Gateway (`scoutlane-ai-gateway`). บันไดโมเดล: `glm-5.2` → `glm-4.7-flashx` → `glm-4.7-flash` (ฟรี จบที่นี่ ไม่ลง Workers AI). คีย์ไม่ขึ้นเบราว์เซอร์. ข้อความจากเรซูเม่ถูกตัดวลีสั่งโมเดลก่อนส่ง.

นัดหมายเป็นตาราง จ–ศ × 08:00–18:00. ถ้ามี Google OAuth จะสร้าง Calendar event + Meet และใส่ชุดคำถามในคำอธิบาย.

## Data

| Binding | Holds |
|---|---|
| D1 `scoutlane-d1-main` | jobs, candidates, shortlist, applications (3 scores + why), interviews, users, settings, candidate_events |
| KV `KV_SESSIONS` | session cookies and encrypted calendar refresh tokens |
| R2 `R2_RESUMES` | uploaded PDFs |
| Durable Object `SlotLock` | booking overlap — source of truth even if Google is down |
| Durable Object `LaneHub` | realtime UI fan-out (no polling) |
| Queue `scoutlane-queue-screen` | long resume scoring |

Candidates enter the tracker only after HR approves a shortlist card. Team calendar busy windows keep start/end only — never other people's event titles.

## Auth

Username + password is the primary login. Passwords are PBKDF2-SHA256 (210k).

The first admin is created from `BOOTSTRAP_USERNAME` / `BOOTSTRAP_PASSWORD` when the `users` table is empty. After that, those env values are not used for login.

MCP clients authenticate with:

1. **PAT** — sign in on the web app, Settings → สร้าง token (`slm_...`), then `Authorization: Bearer slm_...`
2. **OAuth 2.1** — authorization code + PKCE at `apps/mcp` `/authorize`, `/token`, `/register`

Password grant on `/token` is a first-party shortcut for scripts. Do not give it to third-party public clients.

Rate limits sit on login, token mint, authorize, and every MCP tool.

## Roles

Two roles: `admin` and `member`. Permissions live in `packages/core/src/rbac.ts` and are checked on **every** UI API and MCP tool. Role and `disabled` are re-read from D1 — a stolen cookie or PAT cannot keep a demoted or disabled user in power.

| | admin | member |
|---|---|---|
| Jobs, scout, screen, pipeline, interviews, own MCP token | yes | yes |
| Users, AI prompts, โหมดแหล่งค้น | yes | no |

Members who mint a PAT get member tools only. Admin tools are not registered for a member session.

## Validation

Field limits live in `packages/core/src/limits.ts`. The UI uses them for `maxlength`. The API and MCP parse the **same Zod schemas**. Bypassing the UI and posting a 200-character name still gets `400 invalid_body`. Do not add a form check without the matching schema check.

## Dev

```bash
cp apps/web/.dev.vars.example apps/web/.dev.vars
# set SESSION_SECRET, BOOTSTRAP_USERNAME, BOOTSTRAP_PASSWORD
# LLM keys: Settings → โมเดล (not env)
cp apps/web/.dev.vars apps/mcp/.dev.vars
npm install
npm run migrate:local
npm run dev        # web :8787
npm run dev:mcp    # MCP :8790
# both share ../../.wrangler/state so local D1/KV stay in sync
```

Web: http://127.0.0.1:8787  
MCP: http://127.0.0.1:8790/mcp

Live (separate Workers):
- App: https://scout-lane.sornkan.workers.dev
- MCP: https://scout-lane-mcp.sornkan.workers.dev/mcp

## Demo

Custom connector (Claude / Grok / ChatGPT / Gemini): ใส่ `https://scout-lane-mcp.sornkan.workers.dev/mcp` — ไคลเอนต์อ่าน OAuth metadata แล้วเปิดหน้าเข้าสู่ระบบของ Scout Lane (`scout-lane.sornkan.workers.dev`) อัตโนมัติ (authorization code + PKCE). โปรไฟล์ใน UI ใช้สร้าง/เพิกถอน PAT ได้ถ้าเครื่องมือยังไม่รองรับ OAuth.

Cowork / Claude example:

```json
{
  "mcpServers": {
    "scout-lane": {
      "url": "http://127.0.0.1:8790/mcp",
      "headers": { "Authorization": "Bearer slm_..." }
    }
  }
}
```

## Secrets

Never commit `.env` or `.dev.vars`. Prompts live in D1 settings, not in git.

## License

Copyright (c) 2026 ilGentEAcutoO.

Public copies are under the [PolyForm Noncommercial License 1.0.0](LICENSE).
You may read, fork, and run this to study it.

**Any business use requires a paid license**, whether or not you profit from
the software. Email suanwin.paows@gmail.com
(see [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md)).

MIT, Apache-2.0, and AGPL are not used: they allow free use inside a company.

Third-party packages keep their own licenses.
