/* tests/globalTeardown.js */
const fs = require("fs");
const path = require("path");

module.exports = async () => {
  try {
    const p = path.join(process.cwd(), "tests", "globalSetup.log");
    if (fs.existsSync(p)) {
      const out = path.join(process.cwd(), "tests", "globalTeardown.log");
      fs.copyFileSync(p, out);
    }
  } catch {
    // non-fatal
  }
};
