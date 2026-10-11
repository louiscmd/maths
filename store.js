// Storage: Supabase (accounts + private per-user files) when its keys are set, otherwise one local user on disk.
import fs from "node:fs";
import path from "node:path";

export async function createStore() {
  const env = process.env;
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  const anon = env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  if (url && service && anon) return supabaseStore(url, service, anon);
  return fileStore();
}

// Everything lives in one private bucket: <user id>/db.json and <user id>/images/<file>.jpg.
// Only this server (service role) can read it; the browser never gets direct access.
async function supabaseStore(url, service, anon) {
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const BUCKET = "proof";
  let ready = null;
  const ensure = () =>
    (ready ||= sb.storage.createBucket(BUCKET, { public: false }).then(({ error }) => {
      if (error && !/exist/i.test(error.message)) { ready = null; throw error; }
    }));
  const bucket = () => sb.storage.from(BUCKET);
  const read = async (p) => {
    await ensure();
    const { data, error } = await bucket().download(p);
    if (!error) return Buffer.from(await data.arrayBuffer());
    const { data: found } = await bucket().exists(p);
    if (!found) return null;
    throw error;
  };
  const write = async (p, buf, contentType) => {
    await ensure();
    const { error } = await bucket().upload(p, buf, { contentType, upsert: true, cacheControl: "0" });
    if (error) throw error;
  };
  return {
    kind: "supabase",
    auth: { url, anon },
    async userFromToken(token) {
      const { data, error } = await sb.auth.getUser(token);
      return error ? null : data.user;
    },
    async signUp(email, password) {
      const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      return data.user;
    },
    load: async (uid) => { const b = await read(`${uid}/db.json`); return b ? JSON.parse(b.toString("utf8")) : null; },
    save: (uid, db) => write(`${uid}/db.json`, Buffer.from(JSON.stringify(db)), "application/json"),
    putImage: (uid, name, buf) => write(`${uid}/images/${path.basename(name)}`, buf, "image/jpeg"),
    getImage: (uid, name) => read(`${uid}/images/${path.basename(name)}`),
    delImage: async (uid, name) => { await bucket().remove([`${uid}/images/${path.basename(name)}`]); },
    health: async () => { await ensure(); return true; },
  };
}

// Local mode: a single user, no login. On Vercel without Supabase, /tmp is the only writable place (wiped on restart).
function fileStore() {
  const dir = process.env.VERCEL ? "/tmp/proof-data" : path.resolve("data");
  const imgDir = path.join(dir, "images"), dbFile = path.join(dir, "db.json");
  fs.mkdirSync(imgDir, { recursive: true });
  let cache = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, "utf8")) : null;
  const img = (n) => path.join(imgDir, path.basename(n));
  return {
    kind: process.env.VERCEL ? "temp" : "file",
    auth: null,
    load: async () => cache,
    save: async (uid, db) => { cache = db; fs.writeFileSync(dbFile, JSON.stringify(db, null, 2)); },
    putImage: async (uid, name, buf) => fs.writeFileSync(img(name), buf),
    getImage: async (uid, name) => (fs.existsSync(img(name)) ? fs.readFileSync(img(name)) : null),
    delImage: async (uid, name) => fs.rmSync(img(name), { force: true }),
    health: async () => true,
  };
}
