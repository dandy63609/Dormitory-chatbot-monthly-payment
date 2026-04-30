# Martinos Kos Assistant — Adapter Plan
**Branch:** `martinos-kos-adapter`
**Base repo:** Fuenzer Bot (WhatsApp/Telegram personal bot)
**Target product:** Martinos Kos OS — Admin + Tenant WhatsApp chatbot + Supabase
**MVP scope:** Admin mode + Tenant mode only. No outsider/public/calon penghuni flow.

---

## Phase 0 — Safety Checklist
- [x] Created branch `martinos-kos-adapter`
- [ ] Do NOT touch `auth/` folder
- [ ] Do NOT touch `src/lib/waClient.js`
- [ ] Do NOT remove dependencies from `package.json`
- [ ] Do NOT mass-delete old Fuenzer service files yet
- [ ] Await approval before proceeding past this file

---

## Phase 1 — Repository Analysis

### 1.1 Current WhatsApp Message Flow

```
src/index.js
  └── main()
        ├── connectToWhatsApp()           → src/lib/waClient.js
        │     └── makeWASocket (Baileys)
        │     └── returns sock (promise resolves on 'open')
        │
        └── new WhatsAppHandler(sock)     → src/handlers/waHandler.js
              └── setup()
                    └── sock.ev.on('messages.upsert', async (m) => {
                          1. Guard: only process m.type === 'notify'
                          2. Guard: skip msg.key.fromMe (own messages)
                          3. Extract: userId, isGroup, text (from all message types)
                          4. Guard: groups → only respond if bot @mentioned or reply-to-bot
                          5. Clean: strip bot @mention from cleanText
                          6. Guard: skip if cleanText is empty in groups
                          7. Branch A: if cleanText.startsWith('/')
                              └── parse command + args
                              └── logCommand(realId, 'whatsapp', command)
                              └── switch(command) { ... }
                          8. Branch B: else (plain text / AI chat)
                              └── if text.length <= 2 → short message reply
                              └── else → askAiDetailed(cleanText, userId, 'whatsapp', realId)
                          9. Send replyText via sock.sendMessage(remoteJid, { text })
                    })
```

**Key detail — group behaviour:**
- In groups: bot is silent unless `@mentioned` OR it's a direct reply to a bot message.
- `isBotMentioned` checks `mentionedJids` against `botNumber` AND `botLid` (dual-device support).
- After mention is detected, the `@tag` text is stripped from `cleanText` before processing.

**Key detail — message type extraction:**
Text is pulled from (in priority order):
`conversation` → `extendedTextMessage` → `imageMessage.caption` →
`documentMessage.caption` → `videoMessage.caption` → button/template replies.

---

### 1.2 Command Router Location

**File:** `src/handlers/waHandler.js`
**Class:** `WhatsAppHandler`
**Method:** `setup()`
**Approximately:** line 596 onward

Structure:
```
switch (command) {
  case '/ping': ...
  case '/saldo': case '/catat': ... (finance)
  case '/finance_info': ...
  case '/research_info': ...
  case '/downloader': ...
  case '/cuaca': ...
  case '/sholat': ...
  case '/admin': ...
  case '/monitor': ...
  case '/me': ...
  case '/buku': ...
  case '/jurnal': ...
  case '/artikel': ...
  case '/model_info': ...
  case '/switch': ...
  case '/stats': case '/cmd_usage': case '/ai_usage': ...
  case '/broadcast': ...
  case '/img': ...
  case '/img_info': ...
  case '/pdf_info': ...
  case '/sticker_info': ...
  case '/tosticker': ...
  case '/start': ...
  case '/info': ...
  case '/donate': ...
  case '/short': ...
  case '/download': ...
  case '/audio': ...
  default: unknown command reply
}
```

---

### 1.3 Current Fuenzer Commands Exposed in WhatsApp

| Command | Category | Admin Only |
|---|---|---|
| `/ping` | System | No |
| `/start` | System | No |
| `/info` | System | No |
| `/me` | System | No |
| `/saldo` | Finance | No |
| `/catat` | Finance | No |
| `/pemasukan` | Finance | No |
| `/laporan_chart` | Finance | No |
| `/riwayat` | Finance | No |
| `/hapus` | Finance | No |
| `/edit` | Finance | No |
| `/finance_info` | Finance | No |
| `/buku` | Research | No |
| `/jurnal` | Research | No |
| `/artikel` | Research | No |
| `/research_info` | Research | No |
| `/download` | Downloader | No |
| `/audio` | Downloader | No |
| `/downloader` | Downloader | No |
| `/cuaca` | Utility | No |
| `/sholat` | Utility | No |
| `/short` | Utility | No |
| `/img` | Converter | No |
| `/img_info` | Converter | No |
| `/hapusbg` | Converter | No |
| `/ss` | Converter | No |
| `/topdf` | Converter | No |
| `/pdf` | Converter | No |
| `/pdf_info` | Converter | No |
| `/tosticker` | Converter | No |
| `/sticker_info` | Converter | No |
| `/donate` | Donation | No |
| `/model_info` | AI | No |
| `/switch` | AI | No |
| `/admin` | Admin | Yes |
| `/monitor` | Admin | Yes |
| `/stats` | Admin | Yes |
| `/cmd_usage` | Admin | Yes |
| `/ai_usage` | Admin | Yes |
| `/broadcast` | Admin | Yes |

---

### 1.4 Current AI Persona / System Prompt Location

**File:** `src/lib/openrouterClient.js`
**Variable:** `const systemInstruction` (approx. line 26)

Current persona (already partially adapted to "Ibu Kos" but still has Fuenzer-era tone):
```
"Kowe saiki dadi "Ibu Kos" (Admin Kos Martinos) sing manggon neng Semarang"
```

**Notes:**
- The persona is already somewhat aligned to Martinos Kos context.
- Still needs to be replaced with the full "Bu Sri" persona per Phase 4 spec.
- `generationConfig` is hardcoded: `temperature: 0.7, top_p: 0.8, max_tokens: 1024`.
- `formatForWhatsApp()` is applied to ALL platform replies (includes Telegram too — potential bug, but out of scope for now).

---

### 1.5 Existing Supabase Client Usage

**File:** `src/lib/supabaseClient.js`

- Uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (falls back to `SUPABASE_SECRET_KEY` or `SUPABASE_ANON_KEY`).
- Returns a single shared `supabase` client instance (singleton).
- All service files `require('../lib/supabaseClient')` directly.

**Tables currently in use by Fuenzer Bot:**

| Table | Used By | Columns Known |
|---|---|---|
| `command_logs` | logService, broadcastService, admin/index | user_id, platform, command |
| `ai_logs` | logService, broadcastService, admin/index | user_id, platform, model, prompt, input_tokens, output_tokens |
| `user_preferences` | aiPreferenceService | user_id, platform, active_model |
| `finance` | financeService | id, user_id, type, nominal, keterangan, created_at (inferred) |
| `api_quotas` | quotaService | (details not fully inspected) |

**Tables needed for Martinos Kos (to be confirmed against dashboard DB):**

| Table | Purpose | Status |
|---|---|---|
| `buildings` / `kos` | Martinos 1, 2, 3 info | ⚠️ Unconfirmed — dashboard must verify |
| `rooms` / `kamar` | Room codes, floor, capacity | ⚠️ Unconfirmed |
| `tenants` / `penyewa` | Tenant name, room, KTP, phone | ⚠️ Unconfirmed |
| `electricity_periods` | Month/year billing period | ⚠️ Unconfirmed |
| `electricity_payments` | Who paid, when, method | ⚠️ Unconfirmed |
| `whatsapp_groups` | Group JIDs for Martinos 1/2/3 | ⚠️ Unconfirmed — may use env var |
| `announcements` | Announcement records | ⚠️ Unconfirmed — may not exist yet |
| `announcement_deliveries` | Per-group delivery status | ⚠️ Unconfirmed |
| `admin_users` | Admin auth (future upgrade) | ⚠️ Unconfirmed |
| `activity_logs` | Audit trail | ⚠️ Unconfirmed |

> ⚠️ **ACTION REQUIRED before Phase 5/6/8/9 coding:**
> The dashboard is in a **separate repository not present in this codebase**.
> Actual table names and column names must be confirmed by owner before any Supabase queries are written.
> Propose SQL migrations separately and wait for approval.

---

### 1.6 Existing Admin Auth Method

**File:** `src/utils/auth.js`
**Function:** `isAdmin(userId, platform)`

- **WhatsApp:** compares normalized sender number against `ADMIN_WA_NUMBERS` env var (comma/space/semicolon separated).
- **Telegram:** compares against `ADMIN_TELE_IDS` env var.
- Phone normalization: strips `@s.whatsapp.net`, device suffix (`:X`), and all non-digits.
- **MVP verdict:** Sufficient for Phase 7. No Supabase lookup — pure env-var check.
- **Future:** Can be upgraded to query `admin_users` table from Supabase.

---

### 1.7 Existing Broadcast Logic

**Files:**
- `src/services/broadcastService.js` → `getUniqueUsers(platform)`
- `src/commands/admin/index.js` → case `/broadcast`

**How it works:**
1. `/broadcast <message>` (admin only).
2. Collects all unique `user_id` values from `command_logs` + `ai_logs` for the platform.
3. Sends `[ 📢 BROADCAST ADMIN ]\n\n{message}` to each user JID with a 3-second delay.
4. Uses callback pattern: `options.notifyAdmin(text)` + `options.sendToUser(targetId, text)`.
5. Callbacks are provided by `waHandler.js` which has access to `this.sock`.

**Martinos Kos reuse plan:**
- The existing `/broadcast` infrastructure (notify + send callbacks) is a good reference pattern.
- **New `/umumkan` command will NOT reuse this directly** — it targets fixed group JIDs, not all users.
- `martinosAnnouncementService.js` will implement its own group-targeting logic using `sock.sendMessage`.

---

## Phase 2 — Planned File Changes

### Files to EDIT

| File | What Changes |
|---|---|
| `src/handlers/waHandler.js` | Replace `/start`, `/info` content; add role detection gate; add `/kos_info`; add Martinos command cases; redirect old commands to deprecation message; update `default` case |
| `src/lib/openrouterClient.js` | Replace `systemInstruction` with Bu Sri persona |
| `src/config/settings.js` | Change `app.name` from `'Fuenzer Bot'` to `'Martinos Kos Assistant'` |

### Files to CREATE

| File | Purpose |
|---|---|
| `tasks/todo.md` | This file |
| `src/commands/kos/index.js` | Martinos command router — parses commands, checks role, dispatches to admin or tenant handler |
| `src/services/kosService.js` | Supabase queries: buildings, rooms (read-only, shared by admin and tenant) |
| `src/services/tenantService.js` | Supabase queries: tenant lookup by WhatsApp number, own payment status. No proof storage. |
| `src/services/electricityService.js` | Supabase queries: electricity periods, full payment list (admin), mark paid |
| `src/services/martinosAnnouncementService.js` | Send to group JIDs, log announcement |
| `.env.example` | Template for required env vars (including new Martinos group JIDs) |

### Files that MUST NOT BE TOUCHED

| File | Reason |
|---|---|
| `src/lib/waClient.js` | Baileys connection logic — any change risks breaking auth/reconnect |
| `auth/` folder | Session credentials — never touch |
| `src/index.js` | Startup orchestration — stable, only rename `app.name` via settings.js |
| `package.json` | No dependency removal until all old features are confirmed unused |
| `src/lib/supabaseClient.js` | Shared singleton — safe to reuse as-is |
| `src/lib/telegramClient.js` | Out of scope for this phase |
| `src/handlers/teleHandler.js` | Out of scope for this phase |
| `src/jobs/serverMonitor.js` | Cron jobs — unrelated to Martinos scope |
| `src/services/converterService.js` | Old feature — keep until safe to remove |
| `src/services/downloaderService.js` | Old feature — keep until safe to remove |
| `src/services/financeService.js` | Old feature — keep until safe to remove |
| `src/services/researchService.js` | Old feature — keep until safe to remove |
| `src/services/stickerService.js` | Old feature — keep until safe to remove |
| `src/services/donateService.js` | Old feature — keep until safe to remove |
| `src/services/shortenerService.js` | Old feature — keep until safe to remove |
| `src/commands/finance/index.js` | Old feature — keep until safe to remove |
| `src/commands/converter/index.js` | Old feature — keep until safe to remove |
| `src/commands/admin/index.js` | Admin infra — reused as-is |

---

## Phase 3 — Old Command Deprecation Strategy

Commands to hide from `/info` and redirect to deprecation message:

```
/saldo, /catat, /pemasukan, /finance_info, /riwayat, /hapus, /edit,
/laporan_chart, /research_info, /buku, /jurnal, /artikel,
/downloader, /download, /audio,
/model_info, /switch,
/img, /img_info, /hapusbg, /ss,
/pdf, /pdf_info, /topdf, /sticker_info, /tosticker,
/donate, /short
```

**Deprecation reply template:**
```
> *Fitur iki wis ora dipakai nang Martinos Kos* 🙏

Saiki bot iki khusus bantu operasional Martinos Kos.
Ketik /kos_info kanggo lihat menu sing tersedia.
```

Implementation strategy: Add a helper set `DEPRECATED_COMMANDS` in `waHandler.js` and check it before the full `switch()` to avoid touching each individual case.

---

## Phase 4 — Bu Sri Persona (openrouterClient.js)

Replace `systemInstruction` with:

```
You are "Bu Sri", a warm but practical ibu kos from Semarang for Martinos Kos.

Style:
- Use Bahasa Indonesia mixed naturally with Jawa Semarangan/ngoko alus.
- Sound motherly, friendly, and practical.
- Keep WhatsApp replies short and clear.
- Use "Bu", "Le", or "Nduk" naturally, not every sentence.
- Do not mention Fuenzer Bot, Ridwan Yoga Suryantara, model names, token usage,
  CPU/RAM, downloader, converter, or old bot features.
- You only serve two groups: admin/ibu kos, and registered tenants.
- Do NOT engage with unregistered senders. Role detection happens before you are called.
- For admin: guide toward commands (/kos_info, /listrik, /lunas_listrik, /umumkan).
- For tenants: guide toward their own commands (/listrik_saya, /status_bayar, /bayar_listrik).
- Do not claim exact room availability, price, address, or payment status
  unless the data is explicitly provided in the conversation.
- For database-changing actions, tell user to use the command and confirmation flow.
- Never reveal data about other tenants, KTP, home address, or parent contacts.
```

---

## Phase 4.5 — Role Detection Plan

> This runs on EVERY incoming message, before any command is dispatched.
> It determines which mode the sender gets: admin, tenant, or not-registered.

### Detection logic (in order):

```
1. Normalize sender phone number
   WhatsApp userId format: "628xxx@s.whatsapp.net" or "628xxx:Y@s.whatsapp.net"
   → strip @s.whatsapp.net, strip :Y device suffix, strip non-digits
   → result: "62812345678" (E.164 style, no +)

2. isAdmin(userId, 'whatsapp')           [src/utils/auth.js — already working]
   → reads ADMIN_WA_NUMBERS env var
   → if true: role = 'admin'
   → proceed directly to admin command routing

3. if NOT admin:
   → tenantService.getTenantByWhatsAppNumber(senderPhone)
   → queries tenants table WHERE normalized_wa_number = senderPhone
                                AND is_active = true
   → if found: role = 'tenant', attach tenantRecord to message context
   → proceed to tenant command routing

4. if NOT tenant:
   → role = 'unknown'
   → reply not-registered message (see below)
   → STOP — do NOT pass to AI chat
   → return
```

### Not-registered reply:
```
> *Ngapunten ya* 🙏

Nomor panjenengan durung terdaftar sebagai penghuni Martinos Kos.
Nek merasa sudah jadi penghuni, hubungi ibu kos supaya nomore didaftarkan dulu.
```

### Tenant WhatsApp number storage:
- Tenants table must have a column for WhatsApp number (e.g. `whatsapp_number`).
- Format to store: normalized E.164 without + (e.g. `62812345678`).
- Normalization must match how Baileys provides sender userId.
- ⚠️ **Confirm column name with dashboard owner** — may already be `phone`, `no_hp`, or `wa_number`.

### Where role detection lives:
- Implemented as `resolveRole(userId)` in `src/services/tenantService.js`.
- Called in `waHandler.js` before the `switch(command)` block.
- Result object: `{ role: 'admin' | 'tenant' | 'unknown', tenant: tenantRecord | null }`.
- `tenantRecord` is passed as context into `handleKosCommand()` so services never need to re-query.

### AI chat eligibility:
- `role === 'admin'` → AI chat allowed (full Bu Sri persona).
- `role === 'tenant'` → AI chat allowed (Bu Sri persona, tenant-scoped context).
- `role === 'unknown'` → AI chat NOT allowed. Only not-registered reply.

---

## Phase 5 — New Command Architecture

### Message flow after adaptation:

```
waHandler.js (receives message)
  │
  ├── 1. DEPRECATED CHECK
  │       if command is in DEPRECATED_COMMANDS set → reply deprecation message → return
  │
  ├── 2. ROLE DETECTION (all messages, including non-commands)
  │       resolveRole(userId) → { role, tenant }
  │       if role === 'unknown' → reply not-registered message → return
  │
  ├── 3. COMMAND ROUTING (role is now known)
  │       if command.startsWith('/')
  │         → handleKosCommand(command, args, userId, role, tenant, sock, msg)
  │              ├── if role === 'admin'   → admin command switch
  │              └── if role === 'tenant'  → tenant command switch
  │
  │       legacy admin infra (keep as-is for now):
  │         → /admin, /monitor, /stats, /cmd_usage, /ai_usage, /broadcast
  │              → handleAdminCommand() [unchanged]
  │
  └── 4. AI CHAT FALLBACK (non-command, role is admin or tenant)
          → askAiDetailed() [unchanged]
```

### src/commands/kos/index.js responsibilities:
- Export `handleKosCommand(command, args, userId, role, tenant, sock, msg)`
- Check role and dispatch to correct internal handler:
  - `handleAdminKosCommand()` — admin-only commands
  - `handleTenantKosCommand()` — tenant-only commands
- Validate arguments before calling services
- Return reply string

### src/services/kosService.js responsibilities:
- `getBuildingList()` → list all buildings
- `getRoomByCode(roomCode)` → lookup room by code (used by admin)
- Read-only; shared by admin and tenant flows where building/room data is needed

### src/services/tenantService.js responsibilities:
- `getTenantByWhatsAppNumber(phone)` → lookup tenant by normalized WA number
- `getTenantById(tenantId)` → fetch own record (no other tenants)
- `getOwnElectricityStatus(tenantId, bulan, tahun)` → own payment status only
- `resolveRole(userId)` → wraps isAdmin() + tenant lookup, returns `{ role, tenant }`
- **No proof storage** — proof media is forwarded live via `sock.sendMessage`; no file or DB write

### src/commands/kos/index.js in-memory stores:
Three module-level Maps managed here (not in service files):
```
pendingProofUpload    = {}  // { [tenantUserId]: { tenant, bulan, tahun, expiresAt } }
pendingVerifications  = {}  // { [verificationCode]: { tenant, roomCode, bulan, tahun, adminJid, createdAt } }
pendingElectricityPayments = {}  // { [adminUserId]: { roomCode, bulan, tahun, method, expiresAt } }
// pendingAnnouncements lives here too (Phase 9)
```
All maps are cleared via `setTimeout` at 5–30 min. In-memory only: restarts clear all pending state. Acceptable for MVP.

### src/services/electricityService.js responsibilities:
- `getElectricitySummary(bulan, tahun)` → admin: paid/unpaid count grouped by building
- `getUnpaidTenants(bulan, tahun)` → admin: list of unpaid rooms + tenant names (no KTP)
- `markElectricityPaid(roomCode, bulan, tahun, method, adminId)` → update payment record to lunas
- Returns structured objects, not formatted strings

### src/services/martinosAnnouncementService.js responsibilities:
- `getGroupJids(target)` → returns array of group JIDs from env/Supabase
- `sendAnnouncement(sock, target, message)` → calls `sock.sendMessage` for each JID
- `logAnnouncement(target, message, adminId)` → logs to `activity_logs` or console

---

## Phase 6 — Supabase Schema Discovery

> ⚠️ Dashboard is in a separate repository. These are **proposed** table names.
> **Owner must confirm or provide actual names before Phase 8/9 coding begins.**

### Proposed Schema (to be confirmed):

```sql
-- Martinos Kos buildings
CREATE TABLE buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,           -- 'Martinos Kos 1', '2', '3'
  code TEXT UNIQUE NOT NULL,    -- 'martinos1', 'martinos2', 'martinos3'
  address TEXT,
  whatsapp_group_jid TEXT       -- optional: store JID here instead of env
);

-- Rooms per building
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID REFERENCES buildings(id),
  code TEXT UNIQUE NOT NULL,    -- 'M1-1303', 'M2-0201', etc.
  floor INTEGER,
  is_occupied BOOLEAN DEFAULT false
);

-- Tenants
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID REFERENCES rooms(id),
  name TEXT NOT NULL,
  phone TEXT,
  ktp_number TEXT,              -- SENSITIVE — do not expose in groups
  move_in_date DATE,
  move_out_date DATE,
  is_active BOOLEAN DEFAULT true
);

-- Electricity billing periods
CREATE TABLE electricity_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month INTEGER NOT NULL,       -- 1-12
  year INTEGER NOT NULL,
  amount_per_person NUMERIC,
  building_id UUID REFERENCES buildings(id),
  UNIQUE(month, year, building_id)
);

-- Electricity payments per tenant per period
CREATE TABLE electricity_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID REFERENCES electricity_periods(id),
  tenant_id UUID REFERENCES tenants(id),
  room_id UUID REFERENCES rooms(id),
  is_paid BOOLEAN DEFAULT false,
  paid_at TIMESTAMPTZ,
  payment_method TEXT,          -- 'qris', 'transfer', 'cash', etc.
  marked_by TEXT                -- admin user_id
);

-- Announcements
CREATE TABLE announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target TEXT NOT NULL,         -- 'semua', 'martinos1', 'martinos2', 'martinos3'
  message TEXT NOT NULL,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Announcement delivery log
CREATE TABLE announcement_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id UUID REFERENCES announcements(id),
  group_jid TEXT NOT NULL,
  sent_at TIMESTAMPTZ DEFAULT now(),
  success BOOLEAN DEFAULT true
);

-- Activity log (reuse or extend existing pattern)
CREATE TABLE activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id TEXT,
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

> SQL migrations will be proposed as separate files in `tasks/migrations/`.
> Do NOT apply migrations automatically.

---

## Phase 7 — Role-Based Access Control

### Role resolution strategy:
1. `isAdmin(userId, 'whatsapp')` from `src/utils/auth.js` (env-var based, already working)
2. `tenantService.getTenantByWhatsAppNumber(phone)` (Supabase lookup)
3. If neither → unknown → not-registered reply, no further processing

### Command permission matrix:

| Command | Admin | Tenant | Unknown |
|---|---|---|---|
| `/info` | Redirected to /kos_info | Shows tenant menu | Not-registered reply |
| `/start` | Martinos welcome | Martinos welcome | Not-registered reply |
| `/kos_info` | Full admin menu | ❌ admin-only reply | Not-registered reply |
| `/listrik <bulan> <tahun>` | ✅ all tenants summary | ❌ admin-only reply | Not-registered reply |
| `/belum_listrik <bulan> <tahun>` | ✅ unpaid list | ❌ admin-only reply | Not-registered reply |
| `/lunas_listrik <code> <bln> <thn> <method>` | ✅ with confirmation | ❌ admin-only reply | Not-registered reply |
| `/umumkan <target> <msg>` | ✅ with confirmation | ❌ admin-only reply | Not-registered reply |
| `/terima_bukti <code> <method>` | ✅ updates DB + notifies tenant | ❌ admin-only reply | Not-registered reply |
| `/tolak_bukti <code> <reason>` | ✅ notifies tenant | ❌ admin-only reply | Not-registered reply |
| `/listrik_saya` | ❌ tenant-only | ✅ own status only | Not-registered reply |
| `/status_bayar <bulan> <tahun>` | ❌ tenant-only | ✅ own status only | Not-registered reply |
| `/bayar_listrik` | ❌ tenant-only | ✅ sets pending + shows instructions | Not-registered reply |
| Send image/doc after `/bayar_listrik` | N/A | ✅ forwarded to admin, code generated | Not-registered reply |
| AI free chat | ✅ Bu Sri persona | ✅ Bu Sri persona | ❌ blocked entirely |
| `/ping` | ✅ | ✅ | Not-registered reply |
| Old Fuenzer commands | Deprecation msg | Deprecation msg | Not-registered reply |

### Admin-only reply for blocked commands:
```
> *Ngapunten ya* 🙏
Fitur iki khusus admin Martinos Kos.
```

### Tenant-only reply for blocked commands (when admin tries):
```
> *Perintah iku khusus penghuni kos.* 🏠
Untuk admin, gunakan /kos_info.
```

### Privacy boundaries (hard rules, never negotiable):
| Data | Admin (private chat) | Admin (group chat) | Tenant | Unknown |
|---|---|---|---|---|
| Own name, room code | ✅ | ✅ | ✅ | ❌ |
| Own payment status | ✅ | ✅ | ✅ own only | ❌ |
| Other tenants' names | ✅ | ⚠️ (room code only) | ❌ never | ❌ |
| Other tenants' phones | ✅ | ❌ never | ❌ never | ❌ |
| KTP numbers | ✅ | ❌ never | ❌ never | ❌ |
| Home address | ✅ | ❌ never | ❌ never | ❌ |
| Parent contacts | ✅ | ❌ never | ❌ never | ❌ |
| Proof images (other tenants) | ✅ | ❌ never | ❌ never | ❌ |

> Group chat detection uses existing `isGroup` flag from Baileys `msg.key.remoteJid.endsWith('@g.us')`.

---

## Phase 8 — Command Specifications

### 8A — Admin Commands

#### `/info` (when sender is admin)
```
> *Halo, Bu!* 🙏

Gunakan /kos_info untuk melihat menu admin lengkap.
```

#### `/kos_info`
- Admin only
- Returns full admin command menu

#### `/listrik <bulan> <tahun>`
- Admin only
- Arg format: `mei 2025` (Bahasa Indonesia month name or number, 4-digit year)
- Queries `electricity_payments` joined with `electricity_periods`, `rooms`, `buildings`
- Groups results by building
- Returns: period, amount/person, total tenants, paid count, unpaid count per building

#### `/belum_listrik <bulan> <tahun>`
- Admin only
- Returns list: room code, tenant name, building name
- Does NOT include KTP, phone, or home address

#### `/lunas_listrik <room_code> <bulan> <tahun> <method>`
- Admin only
- Does NOT write to DB immediately
- Stores to in-memory `pendingElectricityPayments[userId]`
- Expires after 5 minutes (`setTimeout` to delete entry)
- Confirmation keyword: `YA BAYAR` (exact match, case-insensitive trim)
- On confirm: calls `markElectricityPaid()` → sets `is_paid = true`, records `paid_at`, `payment_method`, `marked_by`

```
pendingElectricityPayments = {}   // module-level Map in src/commands/kos/index.js

on /lunas_listrik M1-1303 mei 2025 qris:
  → validate roomCode, bulan, tahun, method
  → store { roomCode, bulan, tahun, method, expiry: Date.now() + 5min }
  → setTimeout(() => delete pendingElectricityPayments[userId], 5 * 60 * 1000)
  → reply:
      "Bu, tak konfirmasi dulu ya.

      Akan ditandai lunas:
      Kamar: M1-1303
      Periode: Mei 2025
      Metode: QRIS

      Ketik YA BAYAR untuk menyimpan."

on incoming text.trim().toUpperCase() === 'YA BAYAR':
  → check pendingElectricityPayments[userId]
  → if found and not expired → call markElectricityPaid() → reply success
  → if not found → pass to AI chat (do not reply unknown command)
```

---

### 8B — Tenant Commands

#### `/info` (when sender is tenant)
Shows tenant menu:
```
> *Sugeng rawuh, [nama penghuni]!* 🏠

Kamu terdaftar di kamar [room_code].

*Menu Penghuni:*
- /listrik_saya : Status listrik bulanku
- /status_bayar <bulan> <tahun> : Cek status bayar bulan tertentu
- /bayar_listrik : Cara kirim bukti pembayaran
```

#### `/listrik_saya`
- Tenant only
- Queries own payment status for the current month (auto-detect current bulan/tahun)
- Returns: period, amount, payment status, paid_at if paid
- Does NOT reveal any other tenant's data

#### `/status_bayar <bulan> <tahun>`
- Tenant only
- Queries own payment for specified month
- Returns: period, amount, status, method if paid

#### `/bayar_listrik`
- Tenant only
- Returns instructions on how to submit proof:
```
> *Cara Kirim Bukti Bayar Listrik* 📸

Kirim foto/gambar bukti transfer kamu ke chat ini.
Kasih caption: bayar listrik

Contoh: kirim screenshot transfer Bank/QRIS, lalu tulis caption “bayar listrik”.

Bu Kos akan verifikasi dan konfirmasi pembayaranmu.
```

---

### 8C — Payment Proof Flow (Forward-to-Admin, No Storage)

**Design principle:** Proof files are NEVER stored in Supabase, Supabase Storage, or local disk permanently. The bot downloads a media buffer only to forward it, then discards it. All verification state is in-memory only.

---

#### Step 1 — Tenant sends `/bayar_listrik`

```
on command === '/bayar_listrik' AND role === 'tenant':
  → auto-detect current month/year
  → store pendingProofUpload[tenantUserId] = {
        tenant: tenantRecord,
        bulan: currentBulan,
        tahun: currentTahun,
        expiresAt: Date.now() + (10 * 60 * 1000)  // 10 minutes
     }
  → setTimeout(() => delete pendingProofUpload[tenantUserId], 10 * 60 * 1000)
  → reply to tenant:
```
```
> *Cara Kirim Bukti Bayar Listrik* 📸

Kirim foto atau dokumen bukti transfer kamu ke chat ini sekarang ya.

Bukti akan langsung diteruskan ke ibu kos untuk diverifikasi.
Status listrik baru berubah lunas setelah ibu kos konfirmasi.
```

---

#### Step 2 — Tenant sends image or document

**Trigger:** Next message from same tenant is `imageMessage` or `documentMessage`, AND `pendingProofUpload[tenantUserId]` exists and is not expired.

**Baileys detection:**
```js
const isImage = !!msg.message?.imageMessage;
const isDocument = !!msg.message?.documentMessage;
if ((isImage || isDocument) && pendingProofUpload[tenantUserId]) { ... }
```

**Flow:**
```
on (imageMessage or documentMessage) AND pendingProofUpload[tenantUserId] exists:

  1. Pull pending context
     { tenant, bulan, tahun } = pendingProofUpload[tenantUserId]

  2. Generate verification code
     verificationCode = 'BUKTI-' + randomAlphaNumeric(4).toUpperCase()
     e.g. 'BUKTI-8F2K'

  3. Download media buffer
     proofBuffer = await downloadMediaMessage(msg, 'buffer', {},
                     { reuploadRequest: sock.updateMediaMessage })
     mimeType = imageMessage?.mimetype || documentMessage?.mimetype || 'image/jpeg'
     fileName = documentMessage?.fileName || `bukti_${verificationCode}.jpg`

  4. Resolve admin JID
     adminJid = process.env.MARTINOS_ADMIN_WA_JID
     if not set:
       reply to tenant: "Ngapunten, sistem verifikasi pembayaran durung aktif. Hubungi admin kos dulu ya."
       delete pendingProofUpload[tenantUserId]
       return

  5. Send admin notification (text first)
     sock.sendMessage(adminJid, { text: adminNotificationText })

  6. Forward proof media to admin (same JID, separate message)
     if isImage:
       sock.sendMessage(adminJid, { image: proofBuffer, mimetype, caption: `Bukti dari ${tenant.name} - ${verificationCode}` })
     if isDocument:
       sock.sendMessage(adminJid, { document: proofBuffer, mimetype, fileName, caption: `Bukti dari ${tenant.name} - ${verificationCode}` })

  7. Store verification record (in-memory, 30 min expiry)
     pendingVerifications[verificationCode] = {
       code: verificationCode,
       tenantUserId,           // WA JID to notify tenant later
       tenantId: tenant.id,
       tenantName: tenant.name,
       tenantPhone: tenant.whatsapp_number,
       roomCode: tenant.room_code,
       bulan,
       tahun,
       createdAt: Date.now(),
       expiresAt: Date.now() + (30 * 60 * 1000)
     }
     setTimeout(() => delete pendingVerifications[verificationCode], 30 * 60 * 1000)

  8. Delete pending upload state
     delete pendingProofUpload[tenantUserId]

  9. Buffer is now discarded (not stored anywhere)

  10. Reply to tenant:
```
```
> *Bukti pembayaran wis tak teruske ke admin ya* 🧾

Matur nuwun, Mas/Mbak.
Nanti ibu kos tak cek dulu.
Status listrik baru berubah lunas setelah diverifikasi admin.
```

**Admin notification text format:**
```
*Bukti Pembayaran Listrik Masuk* 🧾

Bu, ana bukti transfer mlebu.

Kode Verifikasi: {verificationCode}
Nama: {tenantName}
Kamar: {roomCode}
Periode: {bulan} {tahun}
Nomor WA: {tenantPhone}

Bukti pembayaran tak teruske nang ngisor iki ya, Bu.

Nek pembayaran iki wis bener, balas:
`/terima_bukti {verificationCode} qris`

Nek durung cocok, balas:
`/tolak_bukti {verificationCode} alasan`
```

---

#### Step 3A — Admin accepts: `/terima_bukti <code> <method>`

- Admin only
- Args: `code` (e.g. `BUKTI-8F2K`), `method` (e.g. `qris`, `transfer`, `cash`)

```
on /terima_bukti BUKTI-8F2K qris:

  1. Look up pendingVerifications['BUKTI-8F2K']
     if not found or expired:
       reply to admin: "Ngapunten Bu, kode verifikasi iki wis ora aktif utawa ora ketemu."
       return

  2. Call electricityService.markElectricityPaid(
       roomCode, bulan, tahun, method, adminUserId
     )
     → sets is_paid = true, paid_at = now(), payment_method, marked_by

  3. Notify tenant (send to tenantUserId JID):
```
```
> *Pembayaran listrik wis diverifikasi* ✅

Matur nuwun ya, Mas/Mbak.
Pembayaran listrik bulan {bulan} {tahun} wis diterima lan dicatet lunas.
```
```
  4. Reply to admin:
     "✅ Pembayaran listrik {roomCode} bulan {bulan} {tahun} wis dicatet lunas."

  5. Delete pendingVerifications['BUKTI-8F2K']
```

---

#### Step 3B — Admin rejects: `/tolak_bukti <code> <reason>`

- Admin only
- Args: `code`, `reason` (free text, e.g. `nominal tidak sesuai`)

```
on /tolak_bukti BUKTI-8F2K nominal tidak sesuai:

  1. Look up pendingVerifications['BUKTI-8F2K']
     if not found or expired:
       reply to admin: "Ngapunten Bu, kode verifikasi iki wis ora aktif utawa ora ketemu."
       return

  2. Do NOT call markElectricityPaid()

  3. Notify tenant (send to tenantUserId JID):
```
```
> *Bukti pembayaran durung iso diverifikasi* 🙏

Ngapunten ya, Mas/Mbak.
Bukti pembayaran listrik bulan {bulan} {tahun} durung iso diterima.

Catatan admin:
{reason}

Mangga kirim ulang bukti pembayaran sing bener ya.
```
```
  4. Reply to admin:
     "Baik Bu, bukti dari {tenantName} ({roomCode}) ditolak. Penghuni sudah diberitahu."

  5. Delete pendingVerifications['BUKTI-8F2K']
```

---

**Hard rules for this flow:**
- `proofBuffer` is used only for forwarding and then discarded. No `fs.writeFile`, no Supabase insert, no Storage upload.
- `markElectricityPaid()` is ONLY called from `/terima_bukti` handler.
- `/lunas_listrik` + `YA BAYAR` flow and `/terima_bukti` flow both call `markElectricityPaid()` — they are two separate paths to the same DB update.
- Non-admin cannot use `/terima_bukti` or `/tolak_bukti`.
- If `MARTINOS_ADMIN_WA_JID` is not set, proof upload fails gracefully with an error to the tenant.

---

## Phase 9 — Announcement Commands

### `/umumkan <target> <message>`
Targets: `semua`, `martinos1`, `martinos2`, `martinos3`

- Admin only
- Does NOT send immediately
- Stores to in-memory `pendingAnnouncements[userId]`
- Expires after 5 minutes
- Confirmation keyword: `KIRIM PENGUMUMAN` (exact match, case-insensitive trim)

### Announcement message format:
```
*Pengumuman Martinos Kos* 📢

[message]

Matur nuwun.
- Bu Kos
```

### Group JID resolution (priority order):
1. Query `buildings.whatsapp_group_jid` from Supabase (if column exists)
2. Fall back to env vars: `MARTINOS_GROUP_1_JID`, `MARTINOS_GROUP_2_JID`, `MARTINOS_GROUP_3_JID`
3. If neither → reply error, do not attempt send

---

## Phase 10 — Logging Strategy

For each successful DB write or announcement send:
1. Try to insert into `activity_logs` (if table exists)
2. On error: `console.log` only — never fail the main action
3. Log fields: `actor_id` (admin userId), `action` (string), `details` (JSON)

---

## Phase 11 — Testing Checklist

After implementation, run `npm start` and test manually via WhatsApp.

### Role Detection Tests

| # | Sender | Input | Expected Result |
|---|---|---|---|
| 1 | Admin number | `/kos_info` | Full admin command menu |
| 2 | Registered tenant number | `/info` | Tenant menu with name and room code |
| 3 | Unknown number | `/info` | Not-registered message |
| 4 | Unknown number | Any free chat | Not-registered message (NOT AI reply) |

### Admin Command Tests

| # | Sender | Input | Expected Result |
|---|---|---|---|
| 5 | Admin | `/info` | Redirect to /kos_info |
| 6 | Admin | `/listrik mei 2025` | Electricity summary by building from Supabase |
| 7 | Admin | `/belum_listrik mei 2025` | Unpaid tenant list (no KTP, no phone, no address) |
| 8 | Admin | `/lunas_listrik M1-1303 mei 2025 qris` | Confirmation request — no DB write yet |
| 9 | Admin | Reply: `YA BAYAR` | DB updated — is_paid = true, dashboard reflects paid |
| 10 | Admin | `/umumkan semua Test pengumuman` | Confirmation request — no message sent yet |
| 11 | Admin | Reply: `KIRIM PENGUMUMAN` | Message sent to all configured Martinos groups |
| 12 | Admin | `/saldo` | Deprecation message |
| 13 | Admin | Free chat: "Status listrik gimana Bu?" | Bu Sri persona reply |

### Tenant Command Tests

| # | Sender | Input | Expected Result |
|---|---|---|---|
| 14 | Registered tenant | `/listrik_saya` | Own electricity status for current month only |
| 15 | Registered tenant | `/status_bayar mei 2025` | Own payment status for May 2025 |
| 16 | Registered tenant | `/bayar_listrik` | Instructions for submitting proof |
| 17 | Registered tenant | `/belum_listrik mei 2025` | Admin-only rejection message |
| 18 | Registered tenant | `/kos_info` | Admin-only rejection message |
| 19 | Registered tenant | Free chat: "Kapan air panas?” | Bu Sri persona reply |

### Payment Proof Tests

| # | Sender | Input | Expected Result |
|---|---|---|---|
| 20 | Registered tenant | `/bayar_listrik` | Instructions sent, `pendingProofUpload` set, 10-min expiry |
| 21 | Registered tenant | Sends image (after step 20) | Proof forwarded to `MARTINOS_ADMIN_WA_JID`; admin receives notification text + image; tenant receives “wis tak teruske” reply; `pendingVerifications['BUKTI-XXXX']` created; `pendingProofUpload` cleared |
| 22 | Registered tenant | Sends image WITHOUT `/bayar_listrik` first | Nothing happens (no pending state); message falls through to normal handling |
| 23 | Admin | `/terima_bukti BUKTI-XXXX qris` | `is_paid = true` in Supabase; tenant receives lunas notification; admin receives success reply; verification code cleared |
| 24 | Admin | `/terima_bukti BUKTI-ZZZZ qris` (expired/nonexistent code) | Admin receives “Kode verifikasi iki wis ora aktif utawa ora ketemu”; no DB change |
| 25 | Admin | `/tolak_bukti BUKTI-XXXX nominal tidak sesuai` | `is_paid` stays false; tenant receives rejection + reason; admin receives confirmation; verification code cleared |
| 26 | Registered tenant | `/terima_bukti BUKTI-XXXX qris` (tenant tries) | Admin-only rejection message |
| 27 | Admin | `/lunas_listrik M1-1303 mei 2025 cash` (direct, no proof) | Still works independently — confirmation request as before |
| 28 | Admin | `YA BAYAR` after step 27 | `is_paid = true` via direct admin path, not proof path |

---

## New Environment Variables Required

Add to `.env.example` (NOT `.env`):

```
# Martinos Kos WhatsApp Groups
# Get group JIDs by running: sock.groupMetadata('<group_invite_link>') or logging msg.key.remoteJid in a group
MARTINOS_GROUP_1_JID=
MARTINOS_GROUP_2_JID=
MARTINOS_GROUP_3_JID=

# Admin personal WhatsApp JID for receiving proof forwards
# Format: 628xxxxxxxxx@s.whatsapp.net (include @s.whatsapp.net suffix)
MARTINOS_ADMIN_WA_JID=
```

---

## Risks & Notes

| Risk | Mitigation |
|---|---|
| Supabase table names differ from proposal | Confirm with dashboard owner before Phase 8/9 |
| Tenant WA number column name unknown | Confirm with dashboard owner — may be `phone`, `no_hp`, `wa_number`, `whatsapp_number` |
| Tenant WA number format mismatch (e.g. leading 0 vs 62) | Normalize both stored value and sender ID to digits-only E.164 (strip +, strip 0 prefix → 62xxx) |
| Group JIDs unknown | Use env vars for MVP; store in Supabase later |
| `YA BAYAR` / `KIRIM PENGUMUMAN` collision in group chat | Only triggers if `pendingXxx[userId]` exists for that user |
| Tenant sends image but `pendingProofUpload` has expired (10 min) | Image is silently ignored or falls to AI chat — tenant should re-run `/bayar_listrik` |
| `MARTINOS_ADMIN_WA_JID` not configured | Reply to tenant: "Ngapunten, sistem verifikasi pembayaran durung aktif. Hubungi admin kos dulu ya." No crash, no data loss. |
| Admin JID is wrong (typo in env) | `sock.sendMessage` will fail silently or throw — logged to console, tenant gets generic error |
| Verification code expires (30 min) after admin already saw it | Admin is told code is no longer valid; tenant must re-run `/bayar_listrik` |
| Two tenants submit proof at same time — code collision | Codes are random 4-char alphanumeric (36^4 = ~1.7M combinations) — collision chance negligible for MVP |
| Bot restart wipes all pending verification codes | Acceptable for MVP — must be documented in final report |
| Old Fuenzer imports still in waHandler.js | Leave as-is until all old cases are either redirected or removed in a cleanup phase |
| `formatForWhatsApp()` applied to Telegram too | Known bug, out of scope for this phase |
| `pendingXxx` is in-memory only | Restarts clear all pending. Acceptable for MVP |
| `resolveRole()` adds one Supabase query per message | For MVP, this is acceptable. Can cache with short TTL later if performance degrades |

---

## Status

- [x] Phase 0 — Branch created, todo.md written (v1)
- [x] Scope correction applied — Admin + Tenant mode, no outsider/public flow
- [ ] **AWAITING APPROVAL** — All phases below are blocked until owner confirms

### Blocked on owner confirmation:
- [ ] Supabase tenant table name + WhatsApp number column name
- [ ] Tenant table has `is_active` column or equivalent?
- [ ] `electricity_payments` table exists or needs migration?
- [ ] Confirm `MARTINOS_ADMIN_WA_JID` value (admin personal WA number)

### Ready to implement once unblocked:
- [ ] Phase 2 — White-label identity (/start, /info, /kos_info)
- [ ] Phase 3 — Deprecate old commands
- [ ] Phase 4 — Bu Sri persona (openrouterClient.js)
- [ ] Phase 4.5 — Role detection (tenantService.resolveRole)
- [ ] Phase 5 — Martinos command layer (new files created)
- [ ] Phase 6 — Schema confirmed and migrations proposed
- [ ] Phase 7 — Role-based access control wired into waHandler.js
- [ ] Phase 8A — Admin electricity commands
- [ ] Phase 8B — Tenant electricity commands
- [ ] Phase 8C — Payment proof flow (forward to admin, /terima_bukti, /tolak_bukti)
- [ ] Phase 9 — Announcement commands
- [ ] Phase 10 — Logging
- [ ] Phase 11 — Manual testing (28 test cases)
