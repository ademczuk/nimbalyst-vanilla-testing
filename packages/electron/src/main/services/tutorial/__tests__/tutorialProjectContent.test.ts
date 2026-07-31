import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { KeyboardShortcuts } from "../../../../shared/KeyboardShortcuts";

const tutorialRoot = fileURLToPath(
  new URL("../../../../../resources/tutorial-project/", import.meta.url)
);
const readmePath = resolve(tutorialRoot, "README.md");

function collectShortcutValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  return Object.values(value).flatMap(collectShortcutValues);
}

describe("tutorial project content", () => {
  it("keeps README file links and documented keyboard shortcuts valid", () => {
    const readme = readFileSync(readmePath, "utf8");
    const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
    const relativeTargets = Array.from(readme.matchAll(markdownLinkPattern))
      .map((match) => match[1].trim().match(/^<?([^>\s]+)>?/)?.[1])
      .filter((target): target is string => Boolean(target))
      .filter((target) => !target.startsWith("#"))
      .filter((target) => !/^[a-z][a-z0-9+.-]*:/i.test(target));

    expect(relativeTargets.length).toBeGreaterThan(0);
    for (const target of relativeTargets) {
      const linkedPath = resolve(tutorialRoot, decodeURIComponent(target));
      const templateRelativePath = relative(tutorialRoot, linkedPath);
      const leavesTemplate =
        templateRelativePath === ".." ||
        templateRelativePath.startsWith(`..${sep}`) ||
        isAbsolute(templateRelativePath);
      expect(
        leavesTemplate,
        `README link leaves the tutorial template: ${target}`
      ).toBe(false);
      expect(
        existsSync(linkedPath),
        `README link does not resolve to a file: ${target}`
      ).toBe(true);
      expect(statSync(linkedPath).isFile()).toBe(true);
    }

    const shortcutSection = readme.match(
      /## Keyboard shortcuts\n([\s\S]*?)(?:\n## |\s*$)/
    )?.[1];
    expect(shortcutSection).toBeDefined();

    const documentedShortcuts = shortcutSection!
      .split("\n")
      .filter((line) => line.startsWith("|"))
      .filter((line) => !line.includes("| ---"))
      .slice(1)
      .map((line) => line.split("|")[2]?.trim().replace(/`/g, ""))
      .filter((shortcut): shortcut is string => Boolean(shortcut));
    const appShortcuts = new Set(collectShortcutValues(KeyboardShortcuts));

    expect(documentedShortcuts.length).toBeGreaterThan(0);
    for (const shortcut of documentedShortcuts) {
      expect(
        appShortcuts.has(shortcut),
        `README shortcut is not defined in KeyboardShortcuts.ts: ${shortcut}`
      ).toBe(true);
    }
  });
});
