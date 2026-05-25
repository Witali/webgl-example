/*
 * Purpose: Build helper that compiles wasm/jpeg-idct.wat into jpeg-idct.wasm.
 * Processing blocks:
 * - Load wabt and read the WAT source.
 * - Resolve and validate the module.
 * - Emit the binary WASM artifact used by JPEG decoders.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const wabtFactory = require("wabt");

// Build the checked-in WAT source into the WASM binary consumed by browser tests.
async function main() {
  const wabt = await wabtFactory();
  const sourcePath = path.resolve(__dirname, "..", "wasm", "jpeg-idct.wat");
  const outputPath = path.resolve(__dirname, "..", "wasm", "jpeg-idct.wasm");
  const wat = fs.readFileSync(sourcePath, "utf8");
  const module = wabt.parseWat(sourcePath, wat);

  module.resolveNames();
  module.validate();

  const { buffer } = module.toBinary({
    log: false,
    write_debug_names: false,
  });

  fs.writeFileSync(outputPath, Buffer.from(buffer));
  module.destroy();

  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
