const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const SEED_DIR = path.join(__dirname, '..', 'data');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function dataFile(name) {
  ensureDataDir();
  return path.join(DATA_DIR, name);
}

function seedDataFile(name) {
  const target = dataFile(name);
  if (fs.existsSync(target)) return target;

  const seed = path.join(SEED_DIR, name);
  if (fs.existsSync(seed)) {
    fs.copyFileSync(seed, target);
  }

  return target;
}

module.exports = { DATA_DIR, dataFile, seedDataFile, ensureDataDir };
