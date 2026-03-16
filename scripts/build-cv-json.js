import fs from "fs";
import path from "path";

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "YOUR_AIRTABLE_BASE_ID";
const CVS_TABLE_NAME = process.env.CVS_TABLE_NAME || "CVs";
const CV_ITEMS_TABLE_NAME = process.env.CV_ITEMS_TABLE_NAME || "CV Items";
const CVS_TABLE_ID = process.env.CVS_TABLE_ID || "tbl4GZ7jQcccKPyJu";
const CV_ITEMS_TABLE_ID = process.env.CV_ITEMS_TABLE_ID || "tblTNlBDhAjF32Sna";

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const ISSUE_TITLE = process.env.ISSUE_TITLE || "";
const ISSUE_BODY = process.env.ISSUE_BODY || "";
const BUILD_ALL_CVS = String(process.env.BUILD_ALL_CVS || "").toLowerCase() === "true";
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

function logDebug(message, data) {
  if (data === undefined) {
    console.log(`[build-cv-json] ${message}`);
    return;
  }
  console.log(`[build-cv-json] ${message}: ${JSON.stringify(data)}`);
}

function setOutput(name, value) {
  if (!GITHUB_OUTPUT) return;
  fs.appendFileSync(GITHUB_OUTPUT, `${name}=${String(value)}\n`, "utf8");
}

function parseRecordId(title, body) {
  const titleTokens = String(title).trim().split(/\s+/).filter(Boolean);
  if (String(titleTokens[0] || "").toUpperCase() === "CV_UPDATE" && titleTokens[1]?.startsWith("rec")) {
    return titleTokens[1];
  }

  const bodyMatch = String(body).match(/^recordid\s+(rec[\w]+)/im);
  if (bodyMatch?.[1]) return bodyMatch[1];
  return "";
}

function sanitizeSlug(slug) {
  return String(slug || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
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

function valueOrNull(value) {
  return value === undefined ? null : value;
}


function normalizeRichTextFieldValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value.map((part) => normalizeRichTextFieldValue(part)).join("").trim();
  }

  if (typeof value === "object") {
    const directKeys = ["text", "plain_text", "value", "content", "name"];
    for (const key of directKeys) {
      if (typeof value[key] === "string") return value[key];
    }

    const nestedKeys = ["text", "value", "content", "children", "richText", "rich_text"];
    const nestedParts = [];
    for (const key of nestedKeys) {
      if (value[key] !== undefined && value[key] !== null) {
        const normalized = normalizeRichTextFieldValue(value[key]);
        if (normalized) nestedParts.push(normalized);
      }
    }
    if (nestedParts.length) return nestedParts.join(" ").trim();

    const fallback = [];
    for (const v of Object.values(value)) {
      const normalized = normalizeRichTextFieldValue(v);
      if (normalized) fallback.push(normalized);
    }
    return fallback.join(" ").trim();
  }

  return String(value);
}


function getCvFooterValue(fields) {
  const direct = [fields["CV_Footer"], fields["CV Footer"]];
  for (const candidate of direct) {
    const normalized = normalizeRichTextFieldValue(candidate);
    if (normalized) return normalized;
  }

  const normalizeFieldName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const target = "cvfooter";
  for (const [fieldName, fieldValue] of Object.entries(fields || {})) {
    if (normalizeFieldName(fieldName) !== target) continue;
    const normalized = normalizeRichTextFieldValue(fieldValue);
    if (normalized) return normalized;
  }

  return "";
}


function pushContact(items, title, value) {
  if (value !== undefined && value !== null && String(value).trim() !== "") {
    items.push({ title, content: value, section: "contact" });
  }
}

function pushCoreCompetencies(items, value) {
  if (value !== undefined && value !== null && String(value).trim() !== "") {
    items.push({
      title: "Core Competencies",
      content: value,
      section: "core competencies"
    });
  }
}

function escapeFormulaString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function airtableGetJson(url, contextLabel) {
  logDebug(`Requesting Airtable (${contextLabel})`, url.replace(AIRTABLE_PAT || "", "***"));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json"
    }
  });

  if (!res.ok) {
    const text = await res.text();
    logDebug(`Airtable error body (${contextLabel})`, text);
    throw new Error(`Airtable request failed (${res.status}) during ${contextLabel}: ${text}`);
  }

  return res.json();
}

async function fetchCvRecord(recordId) {
  const tableRef = CVS_TABLE_ID || CVS_TABLE_NAME;
  const url = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(tableRef)}/${encodeURIComponent(recordId)}`;
  return airtableGetJson(url, "fetchCvRecord");
}

async function fetchPublishedCvRecords() {
  const records = [];
  const tableRef = CVS_TABLE_ID || CVS_TABLE_NAME;
  let offset = "";

  do {
    const params = new URLSearchParams({
      filterByFormula: '{Status}="Publish"',
      pageSize: "100"
    });
    if (offset) params.set("offset", offset);

    const url = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(tableRef)}?${params.toString()}`;
    const data = await airtableGetJson(url, "fetchPublishedCvRecords");
    records.push(...(data.records || []));
    offset = data.offset || "";
  } while (offset);

  return records;
}

async function fetchCvItems(recordId, linkedItemIds = []) {
  const out = [];
  let offset = "";

  const useLinkedIds = Array.isArray(linkedItemIds) && linkedItemIds.length > 0;
  const idFormula = useLinkedIds
    ? `OR(${linkedItemIds.map((id) => `RECORD_ID()="${escapeFormulaString(id)}"`).join(",")})`
    : `FIND("${escapeFormulaString(recordId)}", ARRAYJOIN({Parent-CV}))`;

  const filterByFormula = `AND({Publish}=TRUE(), ${idFormula})`;

  do {
    const params = new URLSearchParams({
      filterByFormula,
      pageSize: "100",
      "sort[0][field]": "Manual sort",
      "sort[0][direction]": "asc"
    });
    if (offset) params.set("offset", offset);

    const tableRef = CV_ITEMS_TABLE_ID || CV_ITEMS_TABLE_NAME;
    const url = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(tableRef)}?${params.toString()}`;
    const data = await airtableGetJson(url, "fetchCvItems");

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
    manualsort: valueOrNull(f["Manual sort"])
  };
}

function compareManualSort(a, b) {
  const aKey = String(a.manualsort || "").trim();
  const bKey = String(b.manualsort || "").trim();
  if (aKey && bKey) return aKey.localeCompare(bKey, undefined, { numeric: true, sensitivity: "base" });
  if (aKey) return -1;
  if (bKey) return 1;
  return 0;
}

async function buildAndWriteCv(cvRecord) {
  const fields = cvRecord.fields || {};
  const status = String(fields["Status"] || "").trim();
  const slugRaw = fields["Slug"];
  const slug = sanitizeSlug(slugRaw);
  if (!slug) throw new Error(`CV record ${cvRecord.id} is missing a valid Slug.`);

  const fallbackPath = safeRelativePathFromSlug(slug);
  const relativePath = safeRelativePath(fields["GitHub Path"], fallbackPath);
  const outputPath = path.resolve(relativePath);

  if (status === "Draft") {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    logDebug("Draft status handled", { slug, relativePath, deleted: true });
    return { slug, relativePath, action: "deleted" };
  }

  if (status !== "Publish") {
    logDebug("Skipped non-publish CV", { slug, status });
    return { slug, relativePath, action: "skipped" };
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
  pushCoreCompetencies(items, fields["Core Competencies"]);

  const cvFooter = getCvFooterValue(fields);
  if (String(cvFooter).trim() !== "") {
    items.push({
      title: "CV Footer",
      content: valueOrNull(cvFooter),
      section: "footer"
    });
  }

  const linkedCvItems = Array.isArray(fields["CV Items"]) ? fields["CV Items"] : [];
  const cvItems = await fetchCvItems(cvRecord.id, linkedCvItems);

  cvItems
    .map(mapItem)
    .sort(compareManualSort)
    .forEach((item) => items.push(item));

  const output = { slug, status, items };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");

  logDebug("Wrote CV JSON", { slug, relativePath, itemCount: items.length });
  return { slug, relativePath, action: "written" };
}

async function main() {
  if (!AIRTABLE_PAT) throw new Error("Missing AIRTABLE_PAT secret.");
  if (!AIRTABLE_BASE_ID || AIRTABLE_BASE_ID === "YOUR_AIRTABLE_BASE_ID") {
    throw new Error("AIRTABLE_BASE_ID is not configured.");
  }

  const issueRecordId = parseRecordId(ISSUE_TITLE, ISSUE_BODY);
  const buildAll = BUILD_ALL_CVS || !issueRecordId;

  if (buildAll) {
    const records = await fetchPublishedCvRecords();
    logDebug("Building all published CVs", { count: records.length });
    for (const record of records) {
      await buildAndWriteCv(record);
    }
    setOutput("action", "written_all");
    setOutput("count", records.length);
    return;
  }

  const cvRecord = await fetchCvRecord(issueRecordId);
  const result = await buildAndWriteCv(cvRecord);

  setOutput("record_id", issueRecordId);
  setOutput("slug", result.slug);
  setOutput("relative_path", result.relativePath);
  setOutput("action", result.action);
}

main().catch((err) => {
  const message = err?.message || String(err);
  setOutput("error", message);
  console.error(message);
  process.exit(1);
});
