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

async function ambilCaption(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "facebookexternalhit/1.1" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const og = {};
  const rewriter = new HTMLRewriter().on("meta", {
    element(el) {
      const prop = el.getAttribute("property");
      if (prop === "og:title" || prop === "og:description") {
        og[prop] = el.getAttribute("content");
      }
    },
  });
  await rewriter.transform(res).text();

  return decodeHtml(og["og:description"] || og["og:title"] || "");
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
      const caption = await ambilCaption(cocok[0]);
      if (!caption) {
        await kirimPesan(env, chatId, "Caption tidak ditemukan (mungkin postingan tidak publik).");
      } else {
        const namaFile = bersihkanNama(caption);
        await kirimPesan(
          env,
          chatId,
          `📝 Caption:\n${caption.slice(0, 3500)}\n\n📁 Nama file:\n${namaFile}`
        );
      }
    } catch (e) {
      await kirimPesan(env, chatId, `Gagal: ${e.message}`);
    }
    return new Response("OK");
  },
};
