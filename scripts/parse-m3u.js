const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const inputPath = path.join(projectRoot, "data", "playlist.m3u");
const outputPath = path.join(projectRoot, "lib", "channels.ts");

function slugify(value) {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return slug || "channel";
}

function detectCategory(rawGroup, name) {
  const group = (rawGroup || "").toLowerCase();
  const channelName = (name || "").toLowerCase();

  if (group.includes("bangla") || group === "bd") return "Bangla";
  if (["hindi", "india", "bollywood"].some((item) => group.includes(item))) return "Hindi";
  if (["english", "eng"].some((item) => group.includes(item))) return "English";
  if (["sport", "cricket", "live sports"].some((item) => group.includes(item))) return "Sports";
  if (["kid", "cartoon"].some((item) => group.includes(item))) return "Kids";
  if (["islam", "relig"].some((item) => group.includes(item))) return "Islamic";
  if (group.includes("news")) return "News";
  if (["movie", "cinema", "flix"].some((item) => group.includes(item))) return "Movies";
  if (group.includes("music")) return "Music";
  if (["document", "docu", "nature", "sumon 4k"].some((item) => group.includes(item))) return "Documentary";
  if (["pak", "urdu"].some((item) => group.includes(item))) return "Urdu";

  if (["sport", "sony ten", "star sports", "t sports", "ptv sports", "bt sport", "dd sports"].some((item) => channelName.includes(item))) return "Sports";
  if (["news", "cnn", "bbc", "sky news", "bloomberg", "dw", "ndtv", "cbs", "nhk", "cna"].some((item) => channelName.includes(item))) return "News";
  if (["movie", "cinema", "gold", "flix", "hbo", "action"].some((item) => channelName.includes(item))) return "Movies";
  if (["music", "mtv", "9xm", "gaan", "sangeet", "mastii"].some((item) => channelName.includes(item))) return "Music";
  if (["kids", "nick", "disney", "cartoon", "pogo", "sonic", "cbeebies"].some((item) => channelName.includes(item))) return "Kids";
  if (["bangla", "btv", "somoy", "jamuna", "channel i", "ekattor", "gazi", "asian tv", "atn", "ntv", "rtv", "boishakhi", "deepto"].some((item) => channelName.includes(item))) return "Bangla";
  if (["islam", "madani", "madni", "quran"].some((item) => channelName.includes(item))) return "Islamic";
  if (["discovery", "animal", "earth", "nature", "nat geo", "tlc", "travel"].some((item) => channelName.includes(item))) return "Documentary";

  return "Other";
}

function parseM3u(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const channels = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith("#EXTINF")) continue;

    let streamUrl = "";
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      const possibleUrl = lines[nextIndex];
      if (possibleUrl && !possibleUrl.startsWith("#")) {
        streamUrl = possibleUrl;
        break;
      }
    }

    if (!/^(https?|rtmp):\/\//i.test(streamUrl) && !/^udp:\/\//i.test(streamUrl)) continue;

    const name = (line.includes(",") ? line.split(/,(.*)/s)[1] : "Untitled Channel")
      .replace(/^\s*\d+\s*[.)-]\s*/, "")
      .trim() || "Untitled Channel";
    if (name.startsWith("#")) continue;

    const groupMatch = line.match(/group-title="([^"]*)"/i);
    const logoMatch = line.match(/tvg-logo="([^"]*)"/i);
    const rawCategory = groupMatch?.[1]?.trim() || "Other";
    const logo = logoMatch?.[1]?.trim() || "";

    channels.push({
      name,
      category: detectCategory(rawCategory, name),
      rawCategory,
      logo,
      streamUrl,
    });
  }

  const seen = new Set();
  const deduped = [];

  for (const channel of channels) {
    const key = `${channel.name.toLowerCase()}__${channel.streamUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(channel);
  }

  const usedSlugs = new Map();

  return deduped.map((channel, index) => {
    const base = slugify(channel.name);
    const count = (usedSlugs.get(base) || 0) + 1;
    usedSlugs.set(base, count);

    return {
      id: index + 1,
      slug: count === 1 ? base : `${base}-${count}`,
      ...channel,
      isSecure: channel.streamUrl.startsWith("https://"),
    };
  });
}

const text = fs.readFileSync(inputPath, "utf8");
const channels = parseM3u(text);
const output = `import type { Channel } from "@/lib/types";\n\nexport const channels: Channel[] = ${JSON.stringify(channels, null, 2)};\n`;

fs.writeFileSync(outputPath, output, "utf8");
console.log(`Generated ${channels.length} channels at ${outputPath}`);
