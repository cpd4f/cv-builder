import fs from "fs";
import path from "path";

// ===== Airtable configuration =====
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "YOUR_AIRTABLE_BASE_ID";
const CVS_TABLE_NAME = "CVs";
const CV_ITEMS_TABLE_NAME = "CV Items";

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const ISSUE_TITLE = process.env.ISSUE_TITLE || "";
const ISSUE_BODY = process.env.ISSUE_BODY || "";
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

function setOutput(name, value) {
  if (!GITHUB_OUTPUT) return;
  fs.appendFileSync(GITHUB_OUTPUT, `${name}=${String(value)}\n`, "utf8");
}

function parseRecordId(title, body) {
  const titleTokens = String(title).trim().split(/\s+/).filter(Boolean);
  if (titleTokens[0] === "CV_UPDATE" && titleTokens[1]?.startsWith("rec")) {
    return titleTokens[1];
  }

  const bodyMatch = String(body).match(/^recordId\s+(rec[\w]+)/im);
  if (bodyMatch?.[1]) {
    return bodyMatch[1];
  }

  return "";
}

function sanitizeSlug(slug) {
  return String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_./]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function safeRelativePathFromSlug(slug) {
  return `data/cv/${sanitizeSlug(slug)}.json`;
}

function safeRelativePath(inputPath, fallbackPath) {
  const candidate = String(inputPath || "").trim();
  if (!candidate) return fallbackPath;

  const normalized = path.posix.normalize(candidate.replace(/\\/g, "/"));
  const withoutLeading = normalized.replace(/^\/+/, "");
  if (!withoutLeading || withoutLeading.startsWith("..") || withoutLeading.includes("/../")) {
    throw new Error(`Unsafe GitHub Path: ${candidate}`);
  }
  return withoutLeading;
}

async function airtableGetJson(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable request failed (${res.status}): ${text}`);
  }

  return res.json();
}

function valueOrNull(value) {
  return value === undefined ? null : value;
}

function pushContact(items, title, value) {
  if (value !== undefined && value !== null && String(value).trim() !== "") {
    items.push({ title, content: value, section: "contact" });
  }
}

async function fetchCvRecord(recordId) {
  const url = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(CVS_TABLE_NAME)}/${encodeURIComponent(recordId)}`;
  const data = await airtableGetJson(url);
  return data;
}

async function fetchCvItems(recordId) {
  const out = [];
  let offset = "";

  do {
    const params = new URLSearchParams({
      filterByFormula: `AND({Publish}=TRUE(), FIND(",${recordId},", "," & ARRAYJOIN({CVs}, ",") & ","))`,
      sort: JSON.stringify([{ field: "Manual Sort", direction: "asc" }]),
      pageSize: "100"
    });
    if (offset) params.set("offset", offset);

    const url = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(CV_ITEMS_TABLE_NAME)}?${params.toString()}`;
    const data = await airtableGetJson(url);

    out.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return out;
}

function mapItem(record) {
  const f = record.fields || {};
  return {
    title: valueOrNull(f["Headline"]),
    subtitle: valueOrNull(f["Organization / Subtitle"]),
    location: valueOrNull(f["Location"]),
    start: valueOrNull(f["Start Date"]),
    end: valueOrNull(f["End Date"]),
    dispdate: valueOrNull(f["Display Date"]),
    content: valueOrNull(f["Content"]),
    section: valueOrNull(f["Section"]),
    manualsort: valueOrNull(f["Manual Sort"])
  };
}

async function main() {
  if (!AIRTABLE_PAT) throw new Error("Missing AIRTABLE_PAT secret.");
  if (!AIRTABLE_BASE_ID || AIRTABLE_BASE_ID === "YOUR_AIRTABLE_BASE_ID") {
    throw new Error("AIRTABLE_BASE_ID is not configured.");
  }

  const recordId = parseRecordId(ISSUE_TITLE, ISSUE_BODY);
  if (!recordId) {
    throw new Error("Could not determine Airtable recordId from issue title/body.");
  }

  const cv = await fetchCvRecord(recordId);
  const fields = cv.fields || {};

  const slugRaw = fields["Slug"];
  const slug = sanitizeSlug(slugRaw);
  if (!slug) throw new Error("CV record is missing a valid Slug.");

  const status = String(fields["Status"] || "").trim();
  const fallbackPath = safeRelativePathFromSlug(slug);
  const relativePath = safeRelativePath(fields["GitHub Path"], fallbackPath);
  const outputPath = path.resolve(relativePath);

  setOutput("record_id", recordId);
  setOutput("slug", slug);
  setOutput("relative_path", relativePath);
  setOutput("status", status);

  if (status === "Draft") {
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
      setOutput("action", "deleted");
      console.log(`Deleted ${relativePath}`);
    } else {
      setOutput("action", "noop");
      console.log(`No file to delete for ${relativePath}`);
    }
    return;
  }

  if (status !== "Publish") {
    throw new Error(`Unsupported Status '${status}'. Expected Publish or Draft.`);
  }

  const items = [];

  items.push({
    title: valueOrNull(fields["Person Name"]),
    subtitle: valueOrNull(fields["CV Subtitle"]),
    content: valueOrNull(fields["Intro Summary"]),
    section: "header"
  });

  pushContact(items, "Email", fields["Contact: Email"]);
  pushContact(items, "Website", fields["Contact: Personal Website"]);
  pushContact(items, "Phone", fields["Contact: Phone Number"]);

  const cvItems = await fetchCvItems(recordId);
  cvItems
    .map(mapItem)
    .sort((a, b) => (a.manualsort ?? Number.MAX_SAFE_INTEGER) - (b.manualsort ?? Number.MAX_SAFE_INTEGER))
    .forEach((item) => items.push(item));

  const output = {
    slug,
    status,
    items
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  setOutput("action", "written");
  console.log(`Wrote ${relativePath}`);
}

main().catch((err) => {
  const message = err?.message || String(err);
  setOutput("error", message);
  console.error(message);
  process.exit(1);
});
