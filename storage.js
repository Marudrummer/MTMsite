const fs = require("fs");
const path = require("path");

const SEED_PATH = path.join(__dirname, "db", "data.seed.json");
const RUNTIME_PATH = path.join("/tmp", "data.runtime.json");

let cache = null;

function readJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return null;
  }
}

function getData() {
  if (cache) return cache;
  const runtime = readJsonSafe(RUNTIME_PATH);
  if (runtime) {
    cache = runtime;
    return cache;
  }
  const seed = readJsonSafe(SEED_PATH);
  cache = seed || { posts: [], projects: [], comments: [] };
  if (!cache.comments) cache.comments = [];
  return cache;
}

function saveData(next) {
  cache = next;
  try {
    fs.writeFileSync(RUNTIME_PATH, JSON.stringify(next, null, 2));
  } catch (err) {
    // best-effort on serverless
  }
}

module.exports = { getData, saveData };
