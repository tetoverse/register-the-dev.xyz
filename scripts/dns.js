const fs = require("fs");
const path = require("path");
const net = require("net");
const { execFileSync } = require("child_process");

const DOMAIN = "the-dev.xyz";
const DOMAINS_DIR = path.join(process.cwd(), "domains");
const ADMINS = new Set(["tetoverse"]);
const RESERVED = new Set([
  "www", "api", "admin", "mail", "ns1", "ns2", "status",
  "docs", "support", "cdn", "root", "ftp", "smtp", "imap", "pop"
]);
const ALLOWED_TYPES = new Set(["A", "AAAA", "CNAME", "TXT"]);
const COMMENT_TAG = "managed-by-gh";

const mode = process.argv[2]; // "--check" or "--sync"
const prAuthor = (process.env.PR_AUTHOR || "").toLowerCase();
const baseBranch = process.env.BASE_BRANCH || "main";

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function isValidHostname(host, allowUnderscore = false) {
  const clean = host.endsWith(".") ? host.slice(0, -1) : host;
  if (!clean || clean.length > 253 || !clean.includes(".")) return false;
  const labelRegex = allowUnderscore
    ? /^[a-zA-Z0-9_]([a-zA-Z0-9_-]*[a-zA-Z0-9_])?$/
    : /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
  return clean.split(".").every((label) =>
    label.length >= 1 && label.length <= 63 && labelRegex.test(label)
  );
}

function getOriginalOwner(file) {
  try {
    const raw = execFileSync("git", ["show", `origin/${baseBranch}:${file}`], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"]
    });
    const parsed = JSON.parse(raw);
    return (parsed.owner?.username || "").toLowerCase() || null;
  } catch {
    return null;
  }
}

function checkChangedFiles() {
  const changedRaw = process.env.CHANGED_FILES || "";
  const files = changedRaw.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);

  if (files.length === 0) {
    throw new Error("No files were changed in this Pull Request.");
  }

  const isAdmin = ADMINS.has(prAuthor);

  for (const file of files) {
    const isDomainFile = file.startsWith("domains/") && file.endsWith(".json");

    if (!isDomainFile) {
      if (!isAdmin) {
        throw new Error(`Only JSON files inside 'domains/' can be modified: ${file}`);
      }
      continue;
    }

    const originalOwner = getOriginalOwner(file);
    if (originalOwner && !isAdmin && prAuthor !== originalOwner) {
      throw new Error(
        `Permission denied for '${file}': domain belongs to '${originalOwner}', not '${prAuthor}'.`
      );
    }

    const fullPath = path.join(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      } catch (err) {
        throw new Error(`[${file}] Invalid JSON syntax: ${err.message}`);
      }

      const newOwner = (data.owner?.username || "").toLowerCase();
      if (!isAdmin && prAuthor !== newOwner) {
        throw new Error(
          `Ownership mismatch in '${file}': PR author '${prAuthor}' must match owner.username '${newOwner}'.`
        );
      }
    }
  }
}

function validateRecordValue(file, type, content) {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`[${file}] ${type} record value must be a non-empty string.`);
  }

  const value = content.trim();

  if (value.startsWith("http://") || value.startsWith("https://")) {
    throw new Error(`[${file}] Do not include http:// or https:// in DNS records: ${value}`);
  }

  if (type === "A") {
    if (!net.isIPv4(value) || isPrivateIPv4(value)) {
      throw new Error(`[${file}] Invalid or private IPv4 address: ${value}`);
    }
  } else if (type === "AAAA") {
    if (!net.isIPv6(value) || value === "::1" || value === "::") {
      throw new Error(`[${file}] Invalid or loopback IPv6 address: ${value}`);
    }
  } else if (type === "CNAME") {
    if (!isValidHostname(value, true)) {
      throw new Error(`[${file}] Invalid CNAME target hostname: ${value}`);
    }
  } else if (type === "NS") {
    if (!isValidHostname(value, false)) {
      throw new Error(`[${file}] Invalid NS target hostname: ${value}`);
    }
  } else if (type === "TXT") {
    if (value.length > 500) {
      throw new Error(`[${file}] TXT record exceeds maximum allowed length (500 chars).`);
    }
  }

  return value;
}

function validateAllFiles() {
  if (!fs.existsSync(DOMAINS_DIR)) {
    throw new Error("The 'domains/' directory does not exist.");
  }

  const files = fs.readdirSync(DOMAINS_DIR).filter((f) => f.endsWith(".json"));
  const parsedFiles = new Map();

  for (const file of files) {
    const sub = file.slice(0, -5);

    if (sub !== sub.toLowerCase()) {
      throw new Error(`[${file}] Filename must be entirely lowercase.`);
    }

    const labels = sub.split(".");
    const baseSub = labels[labels.length - 1];

    if (RESERVED.has(sub) || RESERVED.has(baseSub)) {
      throw new Error(`[${file}] '${baseSub}' is a reserved subdomain and cannot be registered.`);
    }

    if (`${sub}.${DOMAIN}`.length > 253) {
      throw new Error(`[${file}] Full domain name exceeds 253 characters.`);
    }

    const baseRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
    const subRegex = /^_?[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

    if (!baseRegex.test(baseSub) || baseSub.length > 63) {
      throw new Error(`[${file}] Invalid base subdomain format: '${baseSub}'.`);
    }

    for (let i = 0; i < labels.length - 1; i++) {
      if (!subRegex.test(labels[i]) || labels[i].length > 63) {
        throw new Error(`[${file}] Invalid nested subdomain label: '${labels[i]}'.`);
      }
    }

    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(DOMAINS_DIR, file), "utf8"));
    } catch (err) {
      throw new Error(`[${file}] Invalid JSON syntax: ${err.message}`);
    }

    if (!data.owner || typeof data.owner.username !== "string" || !data.owner.username.trim()) {
      throw new Error(`[${file}] 'owner.username' is required.`);
    }

    if (typeof data.owner.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.owner.email.trim())) {
      throw new Error(`[${file}] A valid 'owner.email' is required.`);
    }

    if (!data.records || typeof data.records !== "object" || Array.isArray(data.records)) {
      throw new Error(`[${file}] 'records' must be a valid JSON object.`);
    }

    const recordKeys = Object.keys(data.records);
    if (recordKeys.length === 0) {
      throw new Error(`[${file}] At least one DNS record must be defined under 'records'.`);
    }

    if (data.records.CNAME && recordKeys.length > 1) {
      throw new Error(`[${file}] CNAME records cannot be combined with other record types.`);
    }

    if (data.records.NS && recordKeys.length > 1) {
      throw new Error(`[${file}] NS records cannot be combined with other record types.`);
    }

    parsedFiles.set(sub, { file, data, baseSub });
  }

  const desiredRecords = [];

  for (const [sub, { file, data, baseSub }] of parsedFiles) {
    if (sub.includes(".")) {
      const parent = parsedFiles.get(baseSub);
      const owner = data.owner.username.toLowerCase();
      if (!ADMINS.has(owner)) {
        if (!parent) {
          throw new Error(
            `[${file}] Parent domain '${baseSub}.${DOMAIN}' must exist before adding nested subdomain '${sub}.${DOMAIN}'.`
          );
        }
        if (parent.data.owner.username.toLowerCase() !== owner) {
          throw new Error(
            `[${file}] Owner '${owner}' does not match parent domain '${baseSub}.${DOMAIN}' owner.`
          );
        }
      }
    }

    for (const [type, rawVal] of Object.entries(data.records)) {
      if (!ALLOWED_TYPES.has(type)) {
        throw new Error(`[${file}] Unsupported DNS record type: '${type}'.`);
      }

      const values = Array.isArray(rawVal) ? rawVal : [rawVal];
      if (values.length === 0) {
        throw new Error(`[${file}] '${type}' record list cannot be empty.`);
      }

      if (type === "CNAME" && values.length > 1) {
        throw new Error(`[${file}] Only a single CNAME record is allowed.`);
      }

      for (const item of values) {
        const cleanVal = validateRecordValue(file, type, item);
        desiredRecords.push({
          name: `${sub}.${DOMAIN}`,
          type,
          content: cleanVal
        });
      }
    }
  }

  console.log(`Validated ${files.length} domain file(s) and ${desiredRecords.length} DNS record(s).`);
  return desiredRecords;
}

function normalizeContent(type, content) {
  const trimmed = String(content).trim();
  if (type === "TXT") {
    return trimmed.replace(/^"+|"+$/g, "").replace(/\\"/g, '"');
  }
  if (type === "CNAME" || type === "NS") {
    return trimmed.replace(/\.$/, "").toLowerCase();
  }
  if (type === "AAAA") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function recordKey(rec) {
  return `${rec.type}|${rec.name.toLowerCase()}|${normalizeContent(rec.type, rec.content)}`;
}

async function cfRequest(endpoint, options = {}) {
  const token = process.env.CF_API_TOKEN;
  const zoneId = process.env.CF_ZONE_ID;

  if (!token || !zoneId) {
    throw new Error("Missing CF_API_TOKEN or CF_ZONE_ID environment variables.");
  }

  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`Cloudflare API error (${res.status}): ${JSON.stringify(json.errors || json)}`);
  }

  return json;
}

async function listAllCloudflareRecords() {
  const all = [];
  let page = 1;

  while (true) {
    const json = await cfRequest(`/dns_records?per_page=100&page=${page}`);
    all.push(...json.result);
    const totalPages = json.result_info?.total_pages || 1;
    if (page >= totalPages) break;
    page++;
  }

  return all;
}

async function syncCloudflare(desiredRecords) {
  const existing = await listAllCloudflareRecords();
  const managed = existing.filter((r) => r.comment === COMMENT_TAG);

  const desiredMap = new Map(desiredRecords.map((r) => [recordKey(r), r]));
  const managedMap = new Map(managed.map((r) => [recordKey(r), r]));

  // Delete obsolete records first to prevent CNAME/A conflict errors
  for (const [key, rec] of managedMap) {
    if (!desiredMap.has(key)) {
      await cfRequest(`/dns_records/${rec.id}`, { method: "DELETE" });
      console.log(`Deleted: ${rec.type} ${rec.name} -> ${rec.content}`);
    }
  }

  // Create new records
  for (const [key, rec] of desiredMap) {
    if (!managedMap.has(key)) {
      const payloadContent =
        rec.type === "TXT"
          ? `"${normalizeContent("TXT", rec.content).replace(/"/g, '\\"')}"`
          : normalizeContent(rec.type, rec.content);

      await cfRequest("/dns_records", {
        method: "POST",
        body: JSON.stringify({
          type: rec.type,
          name: rec.name,
          content: payloadContent,
          ttl: 1,
          proxied: false,
          comment: COMMENT_TAG
        })
      });
      console.log(`Created: ${rec.type} ${rec.name} -> ${payloadContent}`);
    }
  }

  console.log("Cloudflare DNS synchronization completed successfully.");
}

(async () => {
  try {
    if (mode === "--check") {
      checkChangedFiles();
    }
    const records = validateAllFiles();
    if (mode === "--sync") {
      await syncCloudflare(records);
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
})();
