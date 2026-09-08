#!/usr/bin/env node
/**
 * Bump the MARKETING version (expo.version in app.json), e.g. 1.0.13 -> 1.0.14.
 *
 * Run this ONCE when starting a new release - i.e. after the previous version
 * was approved/released on the App Store. Apple closes a version "train" once
 * it is approved, so a new build under the same marketing version is rejected
 * with ITMS-90186 (Invalid Pre-Release Train) / ITMS-90062. Bumping the version
 * here keeps the train ahead of what Apple has approved.
 *
 * The iOS buildNumber and Android versionCode are handled separately by EAS
 * `autoIncrement`, so this script deliberately touches ONLY the user-facing
 * version - it does not need to run for every build, only per release.
 *
 * Usage:
 *   npm run version:bump            patch bump  (1.0.13 -> 1.0.14)
 *   npm run version:bump -- minor   minor bump  (1.0.13 -> 1.1.0)
 *   npm run version:bump -- major   major bump  (1.0.13 -> 2.0.0)
 */
const fs = require('fs');
const path = require('path');

const appJsonPath = path.join(__dirname, '..', 'app.json');
const config = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));

const level = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(level)) {
  console.error(`Unknown bump level "${level}" - use patch, minor, or major.`);
  process.exit(1);
}

const current = config.expo && config.expo.version;
const parts = String(current).split('.').map((n) => parseInt(n, 10));
if (parts.length !== 3 || parts.some(Number.isNaN)) {
  console.error(`Cannot parse expo.version "${current}" - expected MAJOR.MINOR.PATCH`);
  process.exit(1);
}

let [major, minor, patch] = parts;
if (level === 'major') {
  major += 1;
  minor = 0;
  patch = 0;
} else if (level === 'minor') {
  minor += 1;
  patch = 0;
} else {
  patch += 1;
}

const next = `${major}.${minor}.${patch}`;
config.expo.version = next;
fs.writeFileSync(appJsonPath, JSON.stringify(config, null, 2) + '\n');
console.log(`Bumped marketing version: ${current} -> ${next}`);
console.log('Build numbers (iOS buildNumber / Android versionCode) are still handled by EAS autoIncrement.');
