// Storage: Upstash Redis when its keys are set (works on Vercel), otherwise files on disk.
import fs from "node:fs";
import path from "node:path";

export async function createStore() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    const { Redis } = await import("@upstash/redis");
    const r = new Redis({ url, token, automaticDeserialization: false });
    return {
      kind: "redis",
      load: async () => { const s = await r.get("proof:db"); return s ? JSON.parse(s) : null; },
      save: (db) => r.set("proof:db", JSON.stringify(db)),
      putImage: (name, buf) => r.set(`proof:img:${name}`, buf.toString("base64")),
      getImage: async (name) => { const b = await r.get(`proof:img:${name}`); return b ? Buffer.from(b, "base64") : null; },
      delImage: (name) => r.del(`proof:img:${name}`),
    };
  }

  // Vercel's filesystem is read-only except /tmp, which is wiped when the instance recycles.
  const dir = process.env.VERCEL ? "/tmp/proof-data" : path.resolve("data");
  const imgDir = path.join(dir, "images"), dbFile = path.join(dir, "db.json");
  fs.mkdirSync(imgDir, { recursive: true });
  let cache = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, "utf8")) : null;
  const safeName = (n) => path.join(imgDir, path.basename(n));
  return {
    kind: process.env.VERCEL ? "temp" : "file",
    load: async () => cache,
    save: async (db) => { cache = db; fs.writeFileSync(dbFile, JSON.stringify(db, null, 2)); },
    putImage: async (name, buf) => fs.writeFileSync(safeName(name), buf),
    getImage: async (name) => (fs.existsSync(safeName(name)) ? fs.readFileSync(safeName(name)) : null),
    delImage: async (name) => fs.rmSync(safeName(name), { force: true }),
  };
}
