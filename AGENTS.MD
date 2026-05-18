# Martinos Kos Bot Rules

## Project context

This repo is being adapted from the original Fuenzer bot into Martinos Kos Assistant.

Martinos Kos Assistant is a kos management bot focused on electricity payment and admin-tenant communication.

MVP only supports:
- Admin mode
- Tenant mode

Do not add outsider, public, visitor, or calon-penghuni flows unless explicitly requested.

## Main product direction

Prioritize Martinos Kos behavior over old Fuenzer behavior.

Do not expose old Fuenzer branding, creator profile, donation menu, finance tools, downloader tools, image tools, PDF tools, sticker tools, or unrelated AI utility menus unless explicitly requested.

User-facing bot messages should use polite Indonesian with light Semarang/Javanese-style phrasing.

For admin:
- Address as "Bu"
- Do not use "nduk"

## Production channel decision

WhatsApp is the only production channel for both tenants and admins.

Use WhatsApp for:
- Tenant commands and replies
- Admin commands and replies
- Payment proof forwarding
- Payment proof approval or rejection
- Monitoring alerts
- Group announcements

Do not start, launch, or reconnect Telegram in production.

Do not forward payment proofs to Telegram.

Do not send monitor alerts to Telegram.

Do not add Telegram admin verification, tenant support, or announcement flows unless explicitly requested.

Existing Telegram files and Telegraf dependency are legacy cleanup targets only:
- `src/handlers/teleHandler.js`
- `src/lib/telegramClient.js`
- `telegraf` in `package.json` / `package-lock.json`

Removing the legacy Telegram subsystem is a separate cleanup task. Before removing it, check that no shared utility still depends on Telegram-specific code. Do not re-enable Telegram as a shortcut.

## Current source of truth

Use this file and `tasks/todo.md` as the project direction source of truth.

The README files may still describe the old Fuenzer WhatsApp + Telegram bot and should not override Martinos rules.

If README, package metadata, or old code conflicts with this file, follow this file and update the stale artifact only when the task asks for documentation or cleanup.

## Architecture direction

Keep responsibilities separated.

Client files should only handle platform connection/client setup:
- `src/lib/waClient.js`
- `src/lib/telegramClient.js` is legacy only; do not wire it into production startup.

Handler files should handle incoming platform events/messages:
- `src/handlers/waHandler.js`
- `src/handlers/teleHandler.js` is legacy only; do not wire it into production startup.

Command router files should route commands:
- `src/commands/**`

Service files should contain business logic:
- `src/services/**`

Do not put business logic such as payment verification, Supabase updates, bill marking, or tenant notification directly inside platform client files.

## Database direction

Use the existing Martinos Supabase tables:
- gedung
- kamar
- tagihan_listrik

Do not invent new tables unless explicitly requested.

Do not change Supabase schema unless explicitly requested and approved.

## Security rules

Do not read, print, edit, summarize, or expose:
- .env
- auth_info/
- baileys_auth/
- session/
- WhatsApp session files
- Supabase service role key
- OpenRouter API key
- Telegram bot token
- WhatsApp credentials
- private admin IDs
- private phone numbers

Use `.env.example` only for variable names.

Never print full secrets, tokens, phone numbers, or WhatsApp JIDs in logs, summaries, comments, or responses.

## Approval language rule

Before asking for approval, explain in beginner-friendly natural language:

1. What you want to do
2. Why it is needed
3. The exact command/action
4. What files/data it may affect
5. Risk level: Low / Medium / High
6. Whether I should approve it once or reject it

Do not ask approval using raw command syntax only.

## Risky actions that always require approval

Always ask before:
- installing packages
- changing `.env.example`
- touching deployment config
- running database writes
- changing Supabase schema
- marking electricity bills as paid
- sending WhatsApp messages
- sending Telegram messages to real users/admins
- sending broadcasts
- deleting files/folders
- running migrations
- running git push
- deploying to production

## Code safety rules

Before editing, inspect the relevant files first.

Prefer small, focused changes.

Do not rewrite large files unless necessary.

Do not remove existing working flows unless explicitly requested.

If old Fuenzer code is unrelated to the task, avoid touching it unless it affects Martinos behavior.

After editing JavaScript files, run syntax checks when possible:

```bash
node --check path/to/changed-file.js
```

## Current verification state

Automated tests can pass while production readiness is still incomplete.

Do not claim the bot is production-ready until the WhatsApp manual checklist in `tasks/todo.md` is completed.

Manual WhatsApp testing is still required for:
- Unknown number rejection
- Tenant menu
- Tenant payment status
- Tenant `/bayar_listrik`
- Cash and transfer proof flow
- Admin proof accept/reject
- Admin electricity summaries
- Admin announcements and confirmation

## Change explanation rule

Every time you make a code or file change, explain the change in plain human language.

For each changed file, explain:

1. What was changed
2. Why it was changed
3. How it affects the Martinos Kos bot behavior
4. What risk or side effect may happen
5. What still needs to be manually tested

Do not only say technical things like:
- "updated function"
- "refactored service"
- "fixed handler"

Explain it in project language too.

Example:

Instead of only saying:
"Updated `martinosPaymentVerificationService.js` to normalize `metodeBayar`."

Say:
"Now when a tenant chooses TRANSFER, the bot saves it to Supabase as `Transfer Bank`, because the `tagihan_listrik` table only accepts `Transfer Bank` or `Tunai`. This prevents the payment approval from failing when Bu Kos clicks approve."