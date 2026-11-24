const FB_REGEX = /https?:\/\/(?:www\.|m\.|web\.)?(?:facebook\.com|fb\.watch)\/\S+/;

function decodeHtml(teks) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return teks
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

function bersihkanNama(teks, maks = 100) {
  const bersih = teks
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, "") // hapus emoji
    .replace(/#\S+/g, "")                                      // hapus hashtag
    .replace(/[\\/*?:"<>|\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maks)
    .trim();
  return bersih || "video_facebook";
}

// Ambil isi <meta property="..."> pertama yang cocok (urutan atribut bebas).
function ambilMeta(html, properti) {
  const daftar = new Set(properti.map((p) => p.toLowerCase()));
  const re = /<meta\s+[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const prop = m[0].match(/property=["']([^"']+)["']/i);
    if (!prop || !daftar.has(prop[1].toLowerCase())) continue;
    const content = m[0].match(/content=["']([^"']*)["']/i);
    if (content) return decodeHtml(content[1]);
  }
  return null;
}

// Cari tanggal post dari berbagai sumber di HTML.
// Urutan: meta article:published_time -> JSON-LD datePublished ->
// timestamp unix di data embed (creation_time / publish_time).
// Kembalikan string ISO atau null kalau tidak ditemukan.
function cariTanggal(html) {
  const meta = ambilMeta(html, [
    "article:published_time",
    "og:published_time",
    "article:modified_time",
  ]);
  if (meta) return meta;

  const ld = html.match(/"date(?:Published|Created)"\s*:\s*"([^"]+)"/i);
  if (ld) return ld[1];

  const ts = html.match(/"(?:creation_time|publish_time|published_time)"\s*:\s*"?(\d{10,13})"?/i);
  if (ts) {
    const digit = ts[1];
    const ms = digit.length === 13 ? Number(digit) : Number(digit) * 1000;
    // Sanity check: antara 2000-01-01 dan 2100-01-01
    if (ms > 946684800000 && ms < 4102444800000) return new Date(ms).toISOString();
  }
  return null;
}

// "18 September 2025, 19:30 WIB"
function formatTanggal(nilai) {
  const d = new Date(nilai);
  if (Number.isNaN(d.getTime())) return null;
  return (
    new Intl.DateTimeFormat("id-ID", {
      timeZone: "Asia/Jakarta",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d) + " WIB"
  );
}

// "2025-09-18" (WIB) untuk awalan nama file
function tanggalUntukNamaFile(nilai) {
  const d = new Date(nilai);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(d);
}

async function ambilInfoPost(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "facebookexternalhit/1.1" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  const caption =
    ambilMeta(html, ["og:description"]) || ambilMeta(html, ["og:title"]) || "";
  const tanggalMentah = cariTanggal(html);

  return {
    caption,
    tanggal: tanggalMentah ? formatTanggal(tanggalMentah) : null,
    tanggalFile: tanggalMentah ? tanggalUntukNamaFile(tanggalMentah) : null,
  };
}

async function kirimPesan(env, chatId, teks) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: teks }),
  });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    // Pastikan request benar-benar dari Telegram
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("Forbidden", { status: 403 });
    }

    const update = await request.json();
    const msg = update.message;
    if (!msg?.text) return new Response("OK");

    const chatId = msg.chat.id;
    const cocok = msg.text.match(FB_REGEX);
    if (!cocok) {
      await kirimPesan(env, chatId, "Kirim link postingan Facebook ya.");
      return new Response("OK");
    }

    try {
      const info = await ambilInfoPost(cocok[0]);
      if (!info.caption) {
        await kirimPesan(env, chatId, "Caption tidak ditemukan (mungkin postingan tidak publik).");
      } else {
        const namaFile = bersihkanNama(info.caption);
        const namaDenganTanggal = info.tanggalFile
          ? `${info.tanggalFile}_${namaFile}`
          : namaFile;
        let pesan = `📝 Caption:\n${info.caption.slice(0, 3400)}`;
        if (info.tanggal) pesan += `\n\n📅 Tanggal post:\n${info.tanggal}`;
        pesan += `\n\n📁 Nama file:\n${namaDenganTanggal}`;
        await kirimPesan(env, chatId, pesan);
      }
    } catch (e) {
      await kirimPesan(env, chatId, `Gagal: ${e.message}`);
    }
    return new Response("OK");
  },
};
