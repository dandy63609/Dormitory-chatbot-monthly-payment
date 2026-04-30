# Martinos Kos Assistant â€” MVP Todo
## 0. Safety Rules
- Branch: `martinos-kos-adapter`
- Do not touch `auth/`
- Do not touch `src/lib/waClient.js`
- Do not remove package dependencies
- Do not commit `.env`
- Keep existing WhatsApp/Baileys connection
- Use existing Supabase client
- Do not store payment proof files
- Do not use Supabase Storage or paid APIs
## 1. Actual Supabase Schema
Tables: `gedung`, `kamar`, `tagihan_listrik`
Mapping:
- `gedung.id` â†’ building ID
- `gedung.nama` â†’ building name
- `kamar.id` â†’ room/tenant record ID
- `kamar.gedung_id` â†’ `gedung.id`
- `kamar.nomor_kamar` â†’ room code
- `kamar.nama_penyewa` â†’ tenant name
- `kamar.hp_penyewa` â†’ tenant phone/WhatsApp
- `kamar.status_kamar` â†’ `Terisi` / `Kosong`
- `tagihan_listrik.kamar_id` â†’ `kamar.id`
- `tagihan_listrik.bulan` â†’ month number `int2`
- `tagihan_listrik.tahun` â†’ year `int4`
- `tagihan_listrik.status_bayar` â†’ payment status
- `tagihan_listrik.metode_bayar` â†’ payment method
- `tagihan_listrik.tanggal_bayar` â†’ payment date
## 2. Role Logic
Admin:
- Detected by `isAdmin(userId, 'whatsapp')`
- Uses `ADMIN_WA_NUMBERS` env
Tenant:
- Match normalized WhatsApp sender number to `kamar.hp_penyewa`
- Only if `kamar.status_kamar = Terisi`
- Normalize `08xxx` and `628xxx` before comparison
Unknown:
- Not admin and not registered tenant
- Receives not-registered reply
- Must not reach AI chat
Not-registered reply:
```text
> *Ngapunten ya* ðŸ™
>
> Nomor panjenengan durung terdaftar sebagai penghuni Martinos Kos.
> Nek merasa sudah jadi penghuni, hubungi ibu kos supaya nomore didaftarkan dulu.
```
## 3. Commands
Admin commands:
- `/kos_info`
- `/listrik <bulan> <tahun>`
- `/belum_listrik <bulan> <tahun>`
- `/lunas_listrik <room_code> <bulan> <tahun> <method>`
- `/terima_bukti <code>`
- `/tolak_bukti <code> <reason>`
- `/umumkan <semua|martinos1|martinos2|martinos3> <message>`
Tenant commands:
- `/bayar_listrik`
- `/status_bayar_info`
Deprecated old Fuenzer commands:
- Reply with Martinos deprecation message
- Do not physically delete old services yet
## 4. Tenant Payment Flow
`/bayar_listrik`:
1. Detect current month/year.
2. Find tenant from `kamar.hp_penyewa`.
3. Find `tagihan_listrik` by `kamar.id + bulan + tahun`.
4. Show amount from `MARTINOS_LISTRIK_NOMINAL`, default `55000`.
5. Ask tenant to choose `CASH` or `TRANSFER`.
`CASH`:
- Store pending method = `cash`
- Reply: `Nggih, Mas/Mbak. Nek bayar cash, tulung taruh uang listrik Rp55.000 nang tempat biasa, yaitu di atas kulkas. Sawise ditaruh, foto uangnya ya. Kirim fotone neng chat iki, nanti tak teruske ke admin.`
`TRANSFER`:
- Store pending method = `transfer`
- Show `MARTINOS_BANK_NAME`, `MARTINOS_BANK_ACCOUNT`, `MARTINOS_BANK_ACCOUNT_NAME`
- Ask tenant to send screenshot/photo proof
Image/document proof:
1. Only accepted after `CASH` or `TRANSFER` choice.
2. Download media buffer temporarily.
3. Forward proof to `MARTINOS_ADMIN_WA_JID`.
4. Generate `BUKTI-XXXX` code.
5. Store pending verification in memory.
6. Do not store proof in database.
7. Do not upload proof to Supabase Storage.
8. Reply to tenant that proof was forwarded.
Admin accept `/terima_bukti <code>`:
- Admin only
- Find pending verification
- Update `tagihan_listrik`: `status_bayar = 'lunas'`, `metode_bayar = stored method`, `tanggal_bayar = current date`
- Notify tenant
Admin reject `/tolak_bukti <code> <reason>`:
- Admin only
- Do not update database
- Notify tenant with reason
`/status_bayar_info`:
- Tenant only
- Current month/year
- Show own room, period, nominal, `status_bayar`, `metode_bayar`, `tanggal_bayar` if present
- Never show other tenants' data
## 5. Admin Electricity Flow
`/listrik <bulan> <tahun>`:
- Admin only
- Query `tagihan_listrik` joined with `kamar` and `gedung`
- Summarize paid/unpaid by `gedung`
`/belum_listrik <bulan> <tahun>`:
- Admin only
- List unpaid room code + tenant name + building
- Do not include phone, KTP, parent contact, or address
`/lunas_listrik <room_code> <bulan> <tahun> <method>`:
- Admin only
- Ask confirmation first
- Only update after admin replies `YA BAYAR`
`YA BAYAR`:
- Only works if admin has pending payment confirmation
- Update `tagihan_listrik` to lunas
## 6. Announcement Flow
`/umumkan <target> <message>`:
- Admin only
- Target: `semua`, `martinos1`, `martinos2`, `martinos3`
- Ask confirmation first
- Send only after `KIRIM PENGUMUMAN`
- Group JIDs from `MARTINOS_GROUP_1_JID`, `MARTINOS_GROUP_2_JID`, `MARTINOS_GROUP_3_JID`
## 7. Required Env Vars
Add to `.env.example` only, real values stay in `.env`:
```env
MARTINOS_LISTRIK_NOMINAL=55000
MARTINOS_BANK_NAME=
MARTINOS_BANK_ACCOUNT=
MARTINOS_BANK_ACCOUNT_NAME=
MARTINOS_ADMIN_WA_JID=
MARTINOS_GROUP_1_JID=
MARTINOS_GROUP_2_JID=
MARTINOS_GROUP_3_JID=
```
## 8. Files To Edit/Create
Edit:
- `src/handlers/waHandler.js`
- `src/lib/openrouterClient.js`
- `src/config/settings.js`
- `.env.example`
Create/update:
- `src/commands/kos/index.js`
- `src/services/kosService.js`
- `src/services/tenantService.js`
- `src/services/electricityService.js`
- `src/services/martinosAnnouncementService.js`
Do not touch: `auth/`, `src/lib/waClient.js`, `package.json`, `node_modules/`, `.env`
## 9. Implementation Checklist
- [ ] White-label `/start` and `/info`
- [ ] Add `/kos_info` admin menu
- [ ] Add `DEPRECATED_COMMANDS` handler
- [ ] Update Bu Sri persona
- [x] Implement `tenantService` role lookup using `kamar.hp_penyewa`
- [ ] Implement `electricityService` using `tagihan_listrik`
- [ ] Implement `/status_bayar_info`
- [ ] Implement `/bayar_listrik`
- [ ] Implement `CASH` / `TRANSFER` pending state
- [ ] Implement proof forwarding to admin
- [ ] Implement `/terima_bukti` and `/tolak_bukti`
- [ ] Implement admin `/listrik` and `/belum_listrik`
- [ ] Implement `/lunas_listrik` + `YA BAYAR`
- [ ] Implement `/umumkan` + `KIRIM PENGUMUMAN`
- [ ] Run `npm start`
- [ ] Manual WhatsApp test
## 10. Manual Test Checklist
- [ ] Unknown number `/info` â†’ not registered
- [ ] Tenant `/info` â†’ tenant menu
- [ ] Tenant `/status_bayar_info` â†’ own current status
- [ ] Tenant `/bayar_listrik` â†’ shows Rp55.000 + `CASH` / `TRANSFER`
- [ ] Tenant `CASH` â†’ refrigerator instruction
- [ ] Tenant `TRANSFER` â†’ bank details
- [ ] Tenant sends proof â†’ admin receives proof + `BUKTI` code
- [ ] Admin `/terima_bukti CODE` â†’ `tagihan_listrik` becomes lunas + tenant notified
- [ ] Admin `/tolak_bukti CODE reason` â†’ no DB update + tenant notified
- [ ] Admin `/listrik mei 2025` â†’ summary
- [ ] Admin `/belum_listrik mei 2025` â†’ unpaid list
- [ ] Admin `/lunas_listrik M1-1303 mei 2025 cash` â†’ asks `YA BAYAR`
- [ ] Admin `YA BAYAR` â†’ `tagihan_listrik` becomes lunas
- [ ] Admin `/umumkan semua test` â†’ asks confirmation
- [ ] Admin `KIRIM PENGUMUMAN` â†’ sent to groups
