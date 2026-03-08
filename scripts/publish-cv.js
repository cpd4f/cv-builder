import fs from "fs";
import path from "path";

const payloadRaw = process.env.CV_PAYLOAD;

if (!payloadRaw) {
  throw new Error("Missing CV_PAYLOAD.");
}

const payload = JSON.parse(payloadRaw);

const slug = String(payload.slug || "").trim();
const status = String(payload.status || "").trim();

if (!slug) {
  throw new Error("Missing slug.");
}

const safeSlug = slug
  .toLowerCase()
  .replace(/[^a-z0-9-_]/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-|-$/g, "");

const relativePath = `data/cv/${safeSlug}.json`;
const outputPath = path.resolve(relativePath);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });

if (status !== "Publish") {
  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
    console.log(`Deleted ${relativePath}`);
  } else {
    console.log(`No file to delete for ${relativePath}`);
  }
  process.exit(0);
}

const output = {
  slug: safeSlug,
  status,
  items: Array.isArray(payload.items) ? payload.items : []
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
console.log(`Wrote ${relativePath}`);
