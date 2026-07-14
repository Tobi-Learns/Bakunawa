import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(resolve(root, "src/app/globals.css"), "utf8");
const tokens = new Map(
  [...css.matchAll(/^\s*(--ui-[\w-]+):\s*(#[0-9a-f]{6});/gim)].map((match) => [match[1], match[2]]),
);

function rgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex) {
  const channels = rgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const checks = [
  ["--ui-ink", "--ui-canvas", 7, "primary text"],
  ["--ui-ink-secondary", "--ui-panel", 4.5, "secondary text"],
  ["--ui-ink-muted", "--ui-panel", 4.5, "muted body text"],
  ["--ui-ink-subtle", "--ui-canvas", 4.5, "small disclosure text"],
  ["--ui-action-ink", "--ui-action", 4.5, "primary button"],
  ["--ui-positive", "--ui-panel", 4.5, "success text"],
  ["--ui-warning", "--ui-panel", 4.5, "warning text"],
  ["--ui-danger", "--ui-panel", 4.5, "error text"],
  ["--ui-info", "--ui-panel", 4.5, "informational text"],
];

let failed = false;
for (const [foregroundName, backgroundName, minimum, label] of checks) {
  const foreground = tokens.get(foregroundName);
  const background = tokens.get(backgroundName);
  if (!foreground || !background) {
    console.error(`FAIL ${label}: missing ${!foreground ? foregroundName : backgroundName}`);
    failed = true;
    continue;
  }
  const ratio = contrast(foreground, background);
  const result = ratio >= minimum ? "PASS" : "FAIL";
  console.log(`${result} ${label}: ${ratio.toFixed(2)}:1 (minimum ${minimum}:1)`);
  if (ratio < minimum) failed = true;
}

if (failed) process.exitCode = 1;
