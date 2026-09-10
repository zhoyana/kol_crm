import { readFileSync, writeFileSync } from "node:fs";

const file = "dist/达人采集助手-portable/central-agent.conf";
const lines = readFileSync(file, "utf8").split(/\r?\n/);
const values = Object.fromEntries(
  lines
    .filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    })
);

const currentToken = String(values.CENTRAL_AGENT_TOKEN || "");
const misplacedToken = String(values.CENTRAL_AGENT_NAME || "");
if (!currentToken.startsWith("replace-with-") || !/^[a-f0-9]{32,}$/i.test(misplacedToken)) {
  throw new Error("Portable config does not match the safely repairable placeholder/token swap pattern");
}

const fixed = lines.map((line) => {
  if (line.startsWith("CENTRAL_AGENT_TOKEN=")) return `CENTRAL_AGENT_TOKEN=${misplacedToken}`;
  if (line.startsWith("CENTRAL_AGENT_NAME=")) return "CENTRAL_AGENT_NAME=EDY-业务测试";
  return line;
});
writeFileSync(file, fixed.join("\r\n"), "utf8");
console.log(JSON.stringify({ ok: true, tokenPresent: true, tokenLength: misplacedToken.length, name: "EDY-业务测试" }));
