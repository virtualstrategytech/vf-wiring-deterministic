/* tests/globalSetup.js */
const fs = require("fs");
const path = require("path");

module.exports = async () => {
  // minimal, deterministic env for tests
  process.env.CI = process.env.CI || "true";
  process.env.WEBHOOK_API_KEY = process.env.WEBHOOK_API_KEY || "test-key";
  process.env.SKIP_SMOKE = process.env.SKIP_SMOKE || "false";
  process.env.SKIP_BODY_PARSER = process.env.SKIP_BODY_PARSER || "1";
  process.env.FORCE_PER_REQUEST_AGENT =
    process.env.FORCE_PER_REQUEST_AGENT || "1";
  process.env.FORCE_DETERMINISTIC_IDS =
    process.env.FORCE_DETERMINISTIC_IDS || "1";
  process.env.TEST_PATCH_RAW_BODY = process.env.TEST_PATCH_RAW_BODY || "1";

  // capture a small setup log to help triage CI
  const log = [
    `CI=${process.env.CI}`,
    `WEBHOOK_API_KEY present: ${!!process.env.WEBHOOK_API_KEY}`,
    `SKIP_SMOKE=${process.env.SKIP_SMOKE}`,
    `USE_CHILD_PROCESS_SERVER=${process.env.USE_CHILD_PROCESS_SERVER || "0"}`,
  ].join("\n");
  fs.writeFileSync(
    path.join(process.cwd(), "tests", "globalSetup.log"),
    log + "\n"
  );
};
