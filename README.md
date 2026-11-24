# fb-caption-bot

Cloudflare Worker + bot Telegram: kirim link postingan Facebook, bot membalas
caption-nya, tanggal post (kalau tersedia), dan nama file yang bersih untuk
video yang diunduh.

## Cara pakai

Kirim link Facebook ke bot di Telegram, contoh:

```
https://www.facebook.com/NASA/videos/2408047472966921/
```

Bot membalas:

```
📝 Caption:
<caption post>

📅 Tanggal post:
18 September 2025 pukul 19.30 WIB

📁 Nama file:
2025-09-18_<caption dibersihkan>
```

## Tanggal post

Tanggal dicari dari halaman post, berurutan:

1. Meta `article:published_time` / `og:published_time`
2. JSON-LD `datePublished` / `dateCreated`
3. Timestamp unix di data embed (`creation_time` / `publish_time`)

Kalau tanggal ditemukan, ditampilkan dalam WIB dan dipakai sebagai awalan
nama file (`YYYY-MM-DD_...`). Kalau tidak ditemukan, baris tanggal tidak
ditampilkan dan nama file tetap seperti biasa.

Catatan: Facebook tidak menampilkan tanggal post di halaman yang bisa
diambil tanpa login (sudah dites lewat og-tag, halaman desktop, m.facebook,
oEmbed, dan plugin embed — semuanya tidak memuat tanggal). Jadi untuk
sebagian besar link Facebook, baris tanggal tidak akan muncul. Tanggal yang
dijamin akurat hanya bisa didapat lewat Facebook Graph API dengan access
token.

## Mode debug

Kirim link + kata `debug` untuk melihat data mentah yang diterima Worker:

```
https://www.facebook.com/.../videos/123/ debug
```

Bot membalas pesan biasa, lalu pesan debug berisi URL akhir setelah
redirect, ukuran HTML, daftar meta tag, hasil tiap sumber tanggal, dan
kandidat field tanggal yang ada di HTML. Berguna untuk memastikan apakah
tanggal post memang tidak tersedia untuk link tersebut, atau ada field
tanggal yang belum dikenali bot.

## Deploy

```sh
npx wrangler deploy
```

Secrets yang dibutuhkan: `BOT_TOKEN`, `WEBHOOK_SECRET`.
