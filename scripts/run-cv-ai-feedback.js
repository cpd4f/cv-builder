import fs from "fs";

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || "YOUR_AIRTABLE_BASE_ID";
const CVS_TABLE_NAME = process.env.CVS_TABLE_NAME || "CVs";
const CVS_TABLE_ID = process.env.CVS_TABLE_ID || "tbl4GZ7jQcccKPyJu";
const CV_ITEMS_TABLE_NAME = process.env.CV_ITEMS_TABLE_NAME || "CV Items";
const CV_ITEMS_TABLE_ID = process.env.CV_ITEMS_TABLE_ID || "tblTNlBDhAjF32Sna";

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
    recordId: record.id,
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

  const cvFooter = getCvFooterValue(fields);
  if (String(cvFooter).trim() !== "") {
    items.push({ title: "CV Footer", content: cvFooter, section: "footer" });
  }

  cvItemRecords
    .map(mapItem)
    .sort(compareManualSort)
    .forEach((item) => items.push(item));

  return { slug: String(fields["Slug"] || ""), status: String(fields["Status"] || ""), items };
}



function cvItemToStructuredLine(item, index) {
  const title = item?.title ? `title="${item.title}"` : "title=";
  const subtitle = item?.subtitle ? ` subtitle="${item.subtitle}"` : "";
  const location = item?.location ? ` location="${item.location}"` : "";
  const dispdate = item?.dispdate ? ` date="${item.dispdate}"` : "";
  const section = item?.section ? ` section="${item.section}"` : "";
  const content = String(item?.content || "").trim();
  const parts = [`- [${index + 1}] ${title}${subtitle}${location}${dispdate}${section}`];
  if (content) {
    const oneLineContent = content
      .split("\n")
      .map((line) => line.replace(/\r/g, "").trim())
      .filter(Boolean)
      .join(" ");
    parts.push(`  content: ${oneLineContent}`);
  }
  return parts.join("\n");
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
      parts.push(cvItemToStructuredLine(entry, index));
    });
  }

  return parts.join("\n");
}

async function generateOverallAiFeedback(cvJson) {
  const cvText = cvItemsToStructuredText(cvJson);
  const prompt = [
    "You are an expert CV reviewer.",
    "Assess this CV for clarity, impact, structure, credibility, and writing quality.",
    "Explicitly check for misspellings, typos, grammatical issues, and stylistic inconsistencies.",
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



async function generateItemAiFeedback(cvJson, targetItem, targetIndex) {
  const cvText = cvItemsToStructuredText(cvJson);
  const targetText = cvItemToStructuredLine(targetItem, targetIndex);
  const prompt = [
    "You are an expert CV editor. You are reviewing one specific CV item with the full CV as context.",
    "Goal: improve this single item while avoiding duplication with other entries.",
    "Prioritize recency and impact: recent work experience should carry more weight than older roles.",
    "Give specific rewrite guidance for phrasing, concision, and measurable outcomes where possible.",
    "Return plain text under 160 words with:",
    "1) Quick assessment (1-2 sentences)",
    "2) Suggested edit (2-4 bullets)",
    "3) Duplicate/redundancy warnings (0-2 bullets, only if needed)"
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
        { role: "system", content: "You provide actionable, item-level CV feedback." },
        { role: "user", content: `${prompt}\n\nTARGET ITEM:\n${targetText}\n\nFULL CV CONTEXT:\n${cvText}` }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API failed for item feedback (${response.status}): ${text}`);
  }

  const data = await response.json();
  const feedback = data?.choices?.[0]?.message?.content?.trim();
  if (!feedback) throw new Error("OpenAI API returned empty item feedback.");
  return feedback;
}

async function writeItemAiFeedback(recordId, feedback) {
  const tableRef = CV_ITEMS_TABLE_ID || CV_ITEMS_TABLE_NAME;
  const url = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(tableRef)}/${encodeURIComponent(recordId)}`;
  await airtablePatchJson(url, { fields: { "AI Feedback": feedback } }, "writeItemAiFeedback");
}

function isFeedbackEligibleItem(item) {
  const hasContent = String(item?.content || "").trim() !== "";
  const hasTitle = String(item?.title || "").trim() !== "";
  const sectionKey = String(item?.section || "").trim().toLowerCase();
  if (!hasContent && !hasTitle) return false;
  if (sectionKey === "header" || sectionKey === "contact" || sectionKey === "education" || sectionKey === "second page rail") return false;
  return true;
}


function getCvFieldTarget(cvPayload, key) {
  const items = Array.isArray(cvPayload?.items) ? cvPayload.items : [];
  if (key === "intro") {
    const header = items.find((item) => String(item?.section || "").toLowerCase() === "header");
    if (!header || String(header?.content || "").trim() === "") return null;
    return {
      fieldName: "AI Feedback Intro",
      label: "CV Intro",
      title: header?.title || "",
      content: header?.content || "",
      section: "header"
    };
  }

  if (key === "core") {
    const core = items.find((item) => String(item?.section || "").toLowerCase() === "core competencies");
    if (!core || String(core?.content || "").trim() === "") return null;
    return {
      fieldName: "AI Feedback Core Competencies",
      label: "Core Competencies",
      title: core?.title || "Core Competencies",
      content: core?.content || "",
      section: "core competencies"
    };
  }

  if (key === "footer") {
    const footer = items.find((item) => String(item?.section || "").toLowerCase() === "footer");
    if (!footer || String(footer?.content || "").trim() === "") return null;
    return {
      fieldName: "AI Feedback Footer",
      label: "CV Footer",
      title: footer?.title || "CV Footer",
      content: footer?.content || "",
      section: "footer"
    };
  }

  return null;
}

function cvFieldTargetToStructuredText(target) {
  const title = target?.title ? `title="${target.title}"` : "title=";
  const section = target?.section ? ` section="${target.section}"` : "";
  const content = String(target?.content || "").trim();
  const oneLineContent = content
    .split("\n")
    .map((line) => line.replace(/\r/g, "").trim())
    .filter(Boolean)
    .join(" ");
  return [`- ${title}${section}`, `  content: ${oneLineContent}`].join("\n");
}

async function generateCvFieldAiFeedback(cvJson, target) {
  const cvText = cvItemsToStructuredText(cvJson);
  const targetText = cvFieldTargetToStructuredText(target);
  const prompt = [
    "You are an expert CV editor. Review this specific CV-level block with full CV context.",
    "Goal: improve this block for clarity, specificity, and impact while avoiding duplication with other CV sections.",
    "Prioritize recency and relevance where applicable.",
    "Check for typos, grammar issues, and style inconsistencies.",
    "Return plain text under 150 words with:",
    "1) Quick assessment (1-2 sentences)",
    "2) Suggested rewrite improvements (2-4 bullets)",
    "3) Duplicate/redundancy warnings (0-2 bullets, only if needed)"
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
        { role: "system", content: "You provide actionable CV block-level feedback." },
        { role: "user", content: `${prompt}\n\nTARGET BLOCK (${target.label}):\n${targetText}\n\nFULL CV CONTEXT:\n${cvText}` }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI API failed for CV field feedback (${response.status}): ${text}`);
  }

  const data = await response.json();
  const feedback = data?.choices?.[0]?.message?.content?.trim();
  if (!feedback) throw new Error("OpenAI API returned empty CV field feedback.");
  return feedback;
}

async function writeCvFieldFeedback(recordId, fieldName, feedback) {
  const tableRef = CVS_TABLE_ID || CVS_TABLE_NAME;
  const url = `https://api.airtable.com/v0/${encodeURIComponent(AIRTABLE_BASE_ID)}/${encodeURIComponent(tableRef)}/${encodeURIComponent(recordId)}`;
  await airtablePatchJson(url, { fields: { [fieldName]: feedback } }, "writeCvFieldFeedback");
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

  const cvFieldTargets = [
    getCvFieldTarget(cvPayload, "intro"),
    getCvFieldTarget(cvPayload, "core"),
    getCvFieldTarget(cvPayload, "footer")
  ].filter(Boolean);

  for (const target of cvFieldTargets) {
    const fieldFeedback = await generateCvFieldAiFeedback(cvPayload, target);
    await writeCvFieldFeedback(recordId, target.fieldName, fieldFeedback);
    logDebug("Wrote CV field AI Feedback", { recordId, fieldName: target.fieldName, chars: fieldFeedback.length });
  }

  const mappedItems = cvItems.map(mapItem).sort(compareManualSort);
  const feedbackTargets = mappedItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => isFeedbackEligibleItem(item));

  for (const target of feedbackTargets) {
    if (!target.item.recordId) continue;
    const itemFeedback = await generateItemAiFeedback(cvPayload, target.item, target.index);
    await writeItemAiFeedback(target.item.recordId, itemFeedback);
    logDebug("Wrote AI Feedback for CV Item", { itemRecordId: target.item.recordId, chars: itemFeedback.length });
  }

  setOutput("record_id", recordId);
  setOutput("ai_feedback_written", "true");
  setOutput("ai_cv_field_feedback_written", String(cvFieldTargets.length));
  setOutput("ai_item_feedback_written", String(feedbackTargets.length));
}

main().catch((err) => {
  const message = err?.message || String(err);
  setOutput("error", message);
  console.error(message);
  process.exit(1);
});
