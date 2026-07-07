const fs = require("fs");
const path = require("path");
const solc = require("solc");

const CONTRACTS_DIR = path.join(__dirname, "contracts");
const ARTIFACTS_DIR = path.join(__dirname, "artifacts-custom");

function findImports(importPath) {
  // Resolve node_modules (OpenZeppelin) imports and local contract imports
  const candidates = [
    path.join(__dirname, "node_modules", importPath),
    path.join(CONTRACTS_DIR, importPath),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return { contents: fs.readFileSync(c, "utf8") };
    }
  }
  return { error: "File not found: " + importPath };
}

function compileAll() {
  const files = fs.readdirSync(CONTRACTS_DIR).filter((f) => f.endsWith(".sol"));
  const sources = {};
  for (const f of files) {
    sources[f] = { content: fs.readFileSync(path.join(CONTRACTS_DIR, f), "utf8") };
  }

  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

  if (output.errors) {
    let hasError = false;
    for (const err of output.errors) {
      console.log(err.severity.toUpperCase() + ":", err.formattedMessage);
      if (err.severity === "error") hasError = true;
    }
    if (hasError) {
      console.error("Compilation failed.");
      process.exit(1);
    }
  }

  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  for (const fileName of Object.keys(output.contracts)) {
    for (const contractName of Object.keys(output.contracts[fileName])) {
      const c = output.contracts[fileName][contractName];
      const artifact = {
        contractName,
        abi: c.abi,
        bytecode: "0x" + c.evm.bytecode.object,
        deployedBytecode: "0x" + c.evm.deployedBytecode.object,
      };
      fs.writeFileSync(
        path.join(ARTIFACTS_DIR, contractName + ".json"),
        JSON.stringify(artifact, null, 2)
      );
      console.log("Compiled:", contractName);
    }
  }
}

compileAll();
