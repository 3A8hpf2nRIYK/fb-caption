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

// Daftar semua property/name dari meta tag (untuk debug).
function daftarMeta(html) {
  const re = /<meta\s+[^>]*>/gi;
  const hasil = [];
  let m;
  while ((m = re.exec(html)) !== null && hasil.length < 30) {
    const prop = m[0].match(/(?:property|name)=["']([^"']+)["']/i);
    if (prop && !hasil.includes(prop[1])) hasil.push(prop[1]);
  }
  return hasil;
}

// Cari tanggal post dari berbagai sumber di HTML.
// Urutan: meta article:published_time -> JSON-LD datePublished ->
// timestamp unix di data embed (creation_time / publish_time / ...).
// Catatan: JSON embed Facebook memakai quote yang di-escape (\"key\"),
// jadi pola timestamp dibuat toleran terhadap backslash.
function cariTanggalDetail(html) {
  const checks = { meta: null, jsonLd: null, timestamp: null };

  checks.meta = ambilMeta(html, [
    "article:published_time",
    "og:published_time",
    "article:modified_time",
  ]);
  if (checks.meta) return { nilai: checks.meta, sumber: "meta", checks };

  const ld = html.match(/"date(?:Published|Created)"\s*:\s*"([^"]+)"/i);
  if (ld) {
    checks.jsonLd = ld[1];
    return { nilai: ld[1], sumber: "json-ld", checks };
  }

  const ts = html.match(
    /["\\]*(?:creation_time|publish_time|published_time|created_time)["\\]*\s*:\s*["\\]*(\d{10,13})/i
  );
  if (ts) {
    const digit = ts[1];
    const ms = digit.length === 13 ? Number(digit) : Number(digit) * 1000;
    // Sanity check: antara 2000-01-01 dan 2100-01-01
    if (ms > 946684800000 && ms < 4102444800000) {
      checks.timestamp = digit;
      return { nilai: new Date(ms).toISOString(), sumber: "timestamp", checks };
    }
    checks.timestamp = `${digit} (di luar rentang)`;
  }
  return { nilai: null, sumber: null, checks };
}

// Pindai semua field yang namanya mengandung time/date dan nilainya
// berbentuk tanggal (ISO atau unix 10/13 digit). Untuk debug: membuktikan
// apakah tanggal post ada di HTML yang diterima Worker atau tidak.
function cariKandidatTanggal(html) {
  const re =
    /["\\]*([A-Za-z0-9_]*?(?:time|date)[A-Za-z0-9_]*?)["\\]*\s*:\s*["\\]*(\d{4}-\d{2}-\d{2}[^"\\,}\]]{0,20}|\d{10,13}(?:\.\d+)?)/gi;
  const hasil = new Map();
  let m;
  let n = 0;
  while ((m = re.exec(html)) !== null && hasil.size < 8 && n++ < 5000) {
    const kunci = m[1].toLowerCase();
    if (!hasil.has(kunci)) hasil.set(kunci, m[2]);
  }
  return [...hasil.entries()];
}

// "18 September 2025 pukul 19.30 WIB"
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
  const tanggal = cariTanggalDetail(html);

  return {
    caption,
    tanggal: tanggal.nilai ? formatTanggal(tanggal.nilai) : null,
    tanggalFile: tanggal.nilai ? tanggalUntukNamaFile(tanggal.nilai) : null,
    debug: {
      finalUrl: res.url,
      htmlSize: html.length,
      metaProps: daftarMeta(html),
      checks: tanggal.checks,
      kandidat: cariKandidatTanggal(html),
    },
  };
}

function formatKandidat([kunci, nilai]) {
  let ket = nilai;
  if (/^\d{10}$/.test(nilai)) {
    ket = `${nilai} (${formatTanggal(Number(nilai) * 1000)})`;
  } else if (/^\d{13}(\.\d+)?$/.test(nilai)) {
    ket = `${nilai} (${formatTanggal(Number(nilai))})`;
  }
  return `• ${kunci} = ${ket}`;
}

function buatPesanDebug(info) {
  const d = info.debug;
  const url = d.finalUrl.length > 200 ? d.finalUrl.slice(0, 200) + "…" : d.finalUrl;
  let teks =
    `🔍 Debug\n` +
    `URL akhir: ${url}\n` +
    `HTML: ${d.htmlSize.toLocaleString("id-ID")} byte\n` +
    `Meta: ${d.metaProps.join(", ") || "-"}\n` +
    `\nTanggal:\n` +
    `• meta: ${d.checks.meta || "tidak ada"}\n` +
    `• JSON-LD: ${d.checks.jsonLd || "tidak ada"}\n` +
    `• timestamp: ${d.checks.timestamp || "tidak ada"}`;
  if (d.kandidat.length) {
    teks += `\n\nKandidat tanggal di HTML:\n${d.kandidat.map(formatKandidat).join("\n")}`;
  } else {
    teks += `\n\nKandidat tanggal di HTML: tidak ada`;
  }
  return teks;
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

    // Mode debug: kirim link + kata "debug" untuk melihat data mentah
    // yang diterima Worker (berguna kalau tanggal tidak muncul).
    const debugMode = /debug/i.test(msg.text);

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
      if (debugMode) await kirimPesan(env, chatId, buatPesanDebug(info));
    } catch (e) {
      await kirimPesan(env, chatId, `Gagal: ${e.message}`);
    }
    return new Response("OK");
  },
};
