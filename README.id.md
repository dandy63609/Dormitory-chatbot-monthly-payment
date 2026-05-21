# Martinos Kos WhatsApp Bot

Bot ini khusus untuk operasional Martinos Kos lewat WhatsApp.

Produksi hanya memakai WhatsApp. Fitur lama seperti downloader, finance pribadi, PDF/image tools, sticker, donasi, cuaca, sholat, model switching, dan token usage bukan bagian dari Martinos Kos.

## Fungsi Utama

- Penghuni terdaftar bisa cek dan bayar tagihan listrik.
- Penghuni memilih `/cash` atau `/transfer`, lalu mengirim foto/dokumen bukti bayar.
- Admin menerima bukti bayar dan bisa menerima atau menolak.
- Admin bisa melihat daftar sudah bayar dan belum bayar per bulan.
- Admin bisa mengirim pengumuman ke grup WhatsApp Martinos yang sudah dikonfigurasi.
- Chat bebas tetap ada sebagai Ajeng, asisten Martinos Kos, tanpa menampilkan nama model AI, provider, token, atau RPM.
- Monitor server bisa mengirim peringatan ke WhatsApp admin kalau URL yang dipantau sedang down.

## Command Penghuni

- `/info` atau `/start` - lihat menu penghuni.
- `/kos_info` - lihat menu sesuai role.
- `/bayar_listrik` - cek tagihan listrik yang harus dibayar, paling lama dulu.
- `/cash` - pilih pembayaran tunai setelah `/bayar_listrik`.
- `/transfer` - pilih pembayaran transfer setelah `/bayar_listrik`.
- `/status_bayar_info` - cek status pembayaran listrik.

## Command Admin

- `/info`, `/start`, atau `/kos_info` - lihat menu admin.
- `/listrik <bulan> <tahun>` - ringkasan listrik.
- `/sudah_listrik <bulan> <tahun>` - daftar penghuni yang sudah bayar.
- `/sudah-listrik <bulan> <tahun>` - alias `/sudah_listrik`.
- `/belum_listrik <bulan> <tahun>` - daftar penghuni yang belum bayar.
- `/lunas_listrik <room_code> <bulan> <tahun> <cash|transfer>` - fallback manual untuk mencatat pembayaran.
- `/terima_bukti <code>` - terima bukti bayar penghuni.
- `/tolak_bukti <code> <alasan>` - tolak bukti bayar penghuni.
- `/umumkan <target> <pesan>` - kirim pengumuman ke grup setelah konfirmasi.

Command lama seperti `/model_info`, `/switch`, `/ai_usage`, `/donate`, `/download`, `/pdf`, `/img`, `/tosticker`, `/saldo`, `/cuaca`, dan `/sholat` sengaja tidak tersedia.

## Aturan Aman Pembayaran

- `tagihan_listrik` adalah tabel catatan pembayaran, bukan daftar tagihan bulanan kosong.
- `kamar.status_kamar = 'Terisi'` menentukan siapa yang wajib bayar listrik tiap bulan.
- Tidak ada baris `tagihan_listrik` untuk kamar aktif dan periode tertentu berarti penghuni itu dianggap belum bayar.
- Ringkasan sudah/belum bayar dihitung dari kamar aktif dikurangi baris pembayaran yang sudah `Lunas`.
- `/bayar_listrik` menampilkan status bulan berjalan tanpa membuat baris belum bayar.
- Kalau bulan berjalan sudah lunas, penghuni diberi tahu tidak perlu kirim bukti lagi.
- Reminder tanggal 10 menghubungi penghuni aktif yang belum punya baris pembayaran `Lunas` untuk bulan itu.
- Bukti bayar hanya bisa diterima/ditolak admin dan kode bukti aktif 24 jam.
- Pengumuman admin hanya dikirim ke grup, bukan chat pribadi semua penghuni.

## Development

Install dependency:

```bash
npm install
```

Jalankan verifikasi:

```bash
npm.cmd run verify
```

Jalankan bot:

```bash
npm start
```

Testing manual WhatsApp tetap wajib sebelum produksi karena automated test tidak bisa memastikan delivery WhatsApp asli, JID grup asli, perilaku HP admin, dan forwarding media bukti bayar.
