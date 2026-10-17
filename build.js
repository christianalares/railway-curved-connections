const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const files = ["viz-global.js", "router.js", "content.js"];
const bundle = files.map((file) => fs.readFileSync(path.join(root, file), "utf8")).join("\n;\n");
fs.writeFileSync(path.join(root, "content-bundle.js"), bundle);
