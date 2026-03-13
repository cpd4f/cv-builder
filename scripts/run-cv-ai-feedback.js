import fs from "fs";

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "YOUR_AIRTABLE_BASE_ID";
const CVS_TABLE_NAME = process.env.CVS_TABLE_NAME || "CVs";
const CVS_TABLE_ID = process.env.CVS_TABLE_ID || "tbl4GZ7jQcccKPyJu";

const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ISSUE_TITLE = process.env.ISSUE_TITLE || "";
const ISSUE_BODY = process.env.ISSUE_BODY || "";
const GITHUB_OUTPUT = process.env.GITHUB_OUTPUT;

function logDebug(message, data) {
  if (data === undefined) {
    console.log(`[cv-ai-feedback] ${message}`);
    return;
  }
  console.log(`[cv-ai-feedback] ${message}: ${JSON.stringify(data)}`);
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

function valueOrNull(value) {
  return value === undefined ? null : value;
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
    throw new Error(`Airtable request failed (${res.status}) during ${contextLabel}: ${text}`);
  }

  return res.json();
}

async function airtablePatchJson(url, body, contextLabel) {
  logDebug(`Patching Airtable (${contextLabel})`, url.replace(AIRTABLE_PAT || "", "***"));
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_PAT}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Airtable patch failed (${res.status}) during ${contextLabel}: ${text}`);
  }

  return res.json();
}

async function fetchCvRecord(recordId) {
  const tableRef = CVS_TABLE_ID || CVS_TABLE_NAME;
  const url = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(tableRef)}/${encodeURIComponent(recordId)}`;
  return airtableGetJson(url, "fetchCvRecord");
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

    const tableRef = process.env.CV_ITEMS_TABLE_ID || "tblTNlBDhAjF32Sna";
    const tableName = process.env.CV_ITEMS_TABLE_NAME || "CV Items";
    const ref = tableRef || tableName;
    const url = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(ref)}?${params.toString()}`;
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

function buildCvPayload(cvRecord, cvItemRecords) {
  const fields = cvRecord.fields || {};
  const items = [];
  items.push({
    title: valueOrNull(fields["Person Name"]),
    subtitle: valueOrNull(fields["CV Subtitle"]),
    content: valueOrNull(fields["Intro Summary"]),
    section: "header"
  });

  const pushContact = (title, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      items.push({ title, content: value, section: "contact" });
    }
  };

  pushContact("Email", fields["Contact: Email"]);
  pushContact("Website", fields["Contact: Personal Website"]);
  pushContact("Phone", fields["Contact: Phone Number"]);

  if (fields["Core Competencies"] !== undefined && fields["Core Competencies"] !== null && String(fields["Core Competencies"]).trim() !== "") {
    items.push({ title: "Core Competencies", content: fields["Core Competencies"], section: "core competencies" });
  }

  if (fields["CV_Footer"] !== undefined && fields["CV_Footer"] !== null && String(fields["CV_Footer"]).trim() !== "") {
    items.push({ title: "CV Footer", content: fields["CV_Footer"], section: "footer" });
  }

  cvItemRecords
    .map(mapItem)
    .sort(compareManualSort)
    .forEach((item) => items.push(item));

  return { slug: String(fields["Slug"] || ""), status: String(fields["Status"] || ""), items };
}

function cvItemsToStructuredText(cvJson) {
  const items = Array.isArray(cvJson?.items) ? cvJson.items : [];
  const sectionMap = new Map();

  for (const item of items) {
    const section = String(item?.section || "").trim() || "(unsectioned)";
    if (!sectionMap.has(section)) sectionMap.set(section, []);
    sectionMap.get(section).push(item);
  }

  const parts = [];
  parts.push(`Slug: ${cvJson?.slug || ""}`);

  for (const [section, entries] of sectionMap.entries()) {
    parts.push(`\n## ${section}`);
    entries.forEach((entry, index) => {
      const title = entry?.title ? `title="${entry.title}"` : "title=";
      const subtitle = entry?.subtitle ? ` subtitle="${entry.subtitle}"` : "";
      const location = entry?.location ? ` location="${entry.location}"` : "";
      const dispdate = entry?.dispdate ? ` date="${entry.dispdate}"` : "";
      const content = String(entry?.content || "").trim();
      parts.push(`- [${index + 1}] ${title}${subtitle}${location}${dispdate}`);
      if (content) {
        const oneLineContent = content.split("\n").map((line) => line.replace(/\r/g, "").trim()).filter(Boolean).join(" ");
        parts.push(`  content: ${oneLineContent}`);
      }
    });
  }

  return parts.join("\n");
}

async function generateOverallAiFeedback(cvJson) {
  const cvText = cvItemsToStructuredText(cvJson);
  const prompt = [
    "You are an expert CV reviewer.",
    "Assess this CV for clarity, impact, structure, and credibility.",
    "Return concise feedback in plain text with:",
    "1) Overall assessment (2-3 sentences)",
    "2) Top strengths (3 bullets)",
    "3) Top improvements (3 bullets)",
    "Keep output under 220 words."
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-5.4",
      messages: [
        { role: "system", content: "You provide actionable CV quality feedback." },
        { role: "user", content: `${prompt}\n\nCV DATA:\n${cvText}` }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const feedback = data?.choices?.[0]?.message?.content?.trim();
  if (!feedback) throw new Error("OpenAI API returned empty feedback.");
  return feedback;
}

async function writeOverallAiFeedbackToCv(recordId, feedback) {
  const tableRef = CVS_TABLE_ID || CVS_TABLE_NAME;
  const url = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(tableRef)}/${encodeURIComponent(recordId)}`;
  await airtablePatchJson(url, { fields: { "Overall AI Feedback": feedback } }, "writeOverallAiFeedbackToCv");
}

async function main() {
  if (!AIRTABLE_PAT) throw new Error("Missing AIRTABLE_PAT secret.");
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY secret.");
  if (!AIRTABLE_BASE_ID || AIRTABLE_BASE_ID === "YOUR_AIRTABLE_BASE_ID") {
    throw new Error("AIRTABLE_BASE_ID is not configured.");
  }

  const recordId = parseRecordId(ISSUE_TITLE, ISSUE_BODY);
  if (!recordId) throw new Error("No trigger record id found in issue title/body.");

  const cvRecord = await fetchCvRecord(recordId);
  const linkedCvItems = Array.isArray(cvRecord?.fields?.["CV Items"]) ? cvRecord.fields["CV Items"] : [];
  const cvItems = await fetchCvItems(recordId, linkedCvItems);
  const cvPayload = buildCvPayload(cvRecord, cvItems);
  const feedback = await generateOverallAiFeedback(cvPayload);
  await writeOverallAiFeedbackToCv(recordId, feedback);

  logDebug("Wrote Overall AI Feedback", { recordId, chars: feedback.length });
  setOutput("record_id", recordId);
  setOutput("ai_feedback_written", "true");
}

main().catch((err) => {
  const message = err?.message || String(err);
  setOutput("error", message);
  console.error(message);
  process.exit(1);
});
