export default {
  title: "CV PDF",
  entry: ["cv-print.html"],
  output: ["dist/coleman-davis.pdf"],
  workspaceDir: ".",
  size: "A4",
  // Keep searchable/selectable text by default.
  // For legacy PDF/X output, use: CV_PDF_LEGACY_PRESS_READY=1 npm run pdf:build
  pressReady: false,
  timeout: 120000
};
