// Where posted videos and photos are kept: any S3-compatible storage. Cloudflare R2 is the
// suggested one (10 GB free, free downloads); Backblaze B2 works too. Set these on Render:
//   STORAGE_ENDPOINT    e.g. https://<account id>.r2.cloudflarestorage.com
//   STORAGE_BUCKET      the bucket's name, e.g. huddle-posts
//   STORAGE_KEY_ID      access key id
//   STORAGE_SECRET      secret access key
//   STORAGE_REGION      optional ("auto" for R2; B2 uses its region, e.g. us-west-004)
//   STORAGE_PUBLIC_URL  optional: the bucket's public address. Then the app loads files straight
//                       from storage instead of through this server.
// Without storage, photos are kept in the database (small, compressed) and videos can't be posted.
const { PassThrough } = require("stream");

const env = (k) => String(process.env[k] || "").trim();
const configured = () => !!(env("STORAGE_ENDPOINT") && env("STORAGE_BUCKET") && env("STORAGE_KEY_ID") && env("STORAGE_SECRET"));
const publicUrl = () => env("STORAGE_PUBLIC_URL").replace(/\/+$/, "");

let client = null;
function s3() {
  if (client) return client;
  const { S3Client } = require("@aws-sdk/client-s3");
  client = new S3Client({
    region: env("STORAGE_REGION") || "auto",
    endpoint: env("STORAGE_ENDPOINT"),
    forcePathStyle: true,
    credentials: { accessKeyId: env("STORAGE_KEY_ID"), secretAccessKey: env("STORAGE_SECRET") },
  });
  return client;
}

// Streams an upload (the request body) into storage, stopping if it passes max bytes.
async function put(key, body, contentType, max) {
  const { Upload } = require("@aws-sdk/lib-storage");
  const pass = new PassThrough();
  let size = 0, tooBig = false;
  body.on("data", (c) => {
    size += c.length;
    if (size > max) { tooBig = true; pass.destroy(Object.assign(new Error("too big"), { status: 413 })); body.destroy(); }
  });
  body.on("error", (e) => pass.destroy(e));
  body.pipe(pass);
  const up = new Upload({
    client: s3(),
    params: { Bucket: env("STORAGE_BUCKET"), Key: key, Body: pass, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" },
    queueSize: 2,
    partSize: 8 * 1024 * 1024,
  });
  try { await up.done(); }
  catch (e) { if (tooBig) throw Object.assign(new Error("too big"), { status: 413 }); throw e; }
  if (!size) { await remove(key).catch(() => {}); throw Object.assign(new Error("empty"), { status: 400 }); }
  return size;
}

// Sends a stored file to the browser, passing through Range so videos can seek.
async function pipeTo(key, req, res) {
  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  const range = req.headers.range;
  let r;
  try { r = await s3().send(new GetObjectCommand({ Bucket: env("STORAGE_BUCKET"), Key: key, ...(range ? { Range: range } : {}) })); }
  catch (e) {
    const code = e.$metadata && e.$metadata.httpStatusCode;
    res.writeHead(code === 416 ? 416 : 404); return res.end();
  }
  const head = {
    "content-type": r.ContentType || "application/octet-stream",
    "cache-control": "public, max-age=31536000, immutable",
    "accept-ranges": "bytes",
  };
  if (r.ContentLength != null) head["content-length"] = r.ContentLength;
  if (r.ContentRange) head["content-range"] = r.ContentRange;
  res.writeHead(r.ContentRange ? 206 : 200, head);
  r.Body.on("error", () => res.destroy());
  r.Body.pipe(res);
}

async function remove(key) {
  const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
  await s3().send(new DeleteObjectCommand({ Bucket: env("STORAGE_BUCKET"), Key: key }));
}

module.exports = { configured, publicUrl, put, pipeTo, remove };
