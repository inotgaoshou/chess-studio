#!/usr/bin/env node
// Share the portable check-in UI and contract between the mobile and admin repos.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const admin = resolve(process.argv.find(arg => arg.startsWith("--admin="))?.slice(8) ?? resolve(root, "../../xiangqi-admin-private"));
const files = ["checkinNavigation.ts", "checkinDomain.ts", "checkinApi.ts", "checkinOffline.ts", "LearningCheckin.tsx", "learningCheckin.css"];
for (const file of files) {
  const source = await readFile(resolve(root, "apps/endgame-training/src", file), "utf8");
  const target = resolve(admin, "apps/admin-web/src", file);
  if (process.argv.includes("--check")) {
    if (await readFile(target, "utf8") !== source) throw new Error(`Check-in mirror differs: ${file}`);
  } else await writeFile(target, source);
}
console.log(process.argv.includes("--check") ? "Check-in mirrors match" : "Check-in UI mirrored");
