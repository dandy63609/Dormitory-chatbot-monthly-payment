# Martinos Kos WhatsApp Bot

Martinos Kos WhatsApp Bot helps the kos admin and registered tenants manage electricity payments and kos announcements through WhatsApp.

This project is WhatsApp-only for production. Old utility-bot features are not part of the Martinos product.

## Core Behavior

- Registered tenants can check and pay electricity bills.
- Tenants choose `/cash` or `/transfer`, then send a proof photo or document.
- Admins receive proof notifications and can approve or reject them.
- Admins can list paid and unpaid electricity bills by month and year.
- Admins can send group announcements to configured Martinos WhatsApp groups.
- The bot can answer free-chat questions as Bu Sri, the Martinos Kos assistant, without exposing AI provider, model, token, or RPM details.
- Server monitoring can notify the admin WhatsApp when configured URLs are down.

## WhatsApp Commands

Tenant commands:

- `/info` or `/start` - show tenant menu.
- `/kos_info` - show role-specific menu.
- `/bayar_listrik` - show the oldest unpaid electricity bill first.
- `/cash` - choose cash payment after `/bayar_listrik`.
- `/transfer` - choose bank transfer after `/bayar_listrik`.
- `/status_bayar_info` - check electricity payment status.

Admin commands:

- `/info`, `/start`, or `/kos_info` - show admin menu.
- `/listrik <bulan> <tahun>` - show electricity summary.
- `/sudah_listrik <bulan> <tahun>` - list tenants already paid.
- `/sudah-listrik <bulan> <tahun>` - alias for `/sudah_listrik`.
- `/belum_listrik <bulan> <tahun>` - list tenants not yet paid.
- `/lunas_listrik <room_code> <bulan> <tahun> <cash|transfer>` - manual fallback to record payment.
- `/terima_bukti <code>` - approve tenant proof.
- `/tolak_bukti <code> <reason>` - reject tenant proof.
- `/umumkan <target> <message>` - send a group announcement after confirmation.

Deprecated old utility commands such as `/model_info`, `/switch`, `/ai_usage`, `/donate`, `/download`, `/pdf`, `/img`, `/tosticker`, `/saldo`, `/cuaca`, and `/sholat` are intentionally unavailable.

## Payment Safety Rules

- `/bayar_listrik` shows the oldest unpaid bill first.
- If the current month is already paid, tenants are told they do not need to send proof again.
- Tenant reminders on the 10th only message tenants with existing unpaid bill rows.
- Reminder jobs do not create missing monthly bills.
- Proof approval is admin-only and proof codes expire after 24 hours.
- Admin announcements are group-only, not direct messages to every tenant.

## Environment

Copy `.env.example` to `.env` and configure the required variable names for:

- WhatsApp/Baileys session
- Supabase
- OpenRouter
- Martinos admin and group JIDs
- Optional monitoring URLs

Do not commit real `.env`, WhatsApp sessions, Supabase keys, or private JIDs.

## Development

Install dependencies:

```bash
npm install
```

Run tests and syntax checks:

```bash
npm.cmd run verify
```

Start the bot locally:

```bash
npm start
```

Manual WhatsApp testing is still required before production use because automated tests cannot prove real WhatsApp session delivery, real group JIDs, admin phone behavior, or payment-proof media forwarding.
