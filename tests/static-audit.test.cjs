const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const mainJs = fs.readFileSync(path.join(rootDir, "main.js"), "utf8");
const stylesCss = fs.readFileSync(path.join(rootDir, "styles.css"), "utf8");

test("Static Audit: No duplicate top-level function or class declarations in main.js", () => {
  const lines = mainJs.split(/\r?\n/);
  const functionDecls = {};
  const classDecls = {};

  lines.forEach((line, index) => {
    const fnMatch = line.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/);
    if (fnMatch) {
      const name = fnMatch[1];
      (functionDecls[name] = functionDecls[name] || []).push(index + 1);
    }
    const classMatch = line.match(/^class\s+([A-Za-z_$][\w$]*)/);
    if (classMatch) {
      const name = classMatch[1];
      (classDecls[name] = classDecls[name] || []).push(index + 1);
    }
  });

  const duplicateFunctions = Object.entries(functionDecls).filter(([, lines]) => lines.length > 1);
  assert.deepEqual(
    duplicateFunctions,
    [],
    `Found duplicate top-level functions: ${duplicateFunctions.map(([n, l]) => `${n} on lines ${l.join(",")}`).join("; ")}`,
  );

  const duplicateClasses = Object.entries(classDecls).filter(([, lines]) => lines.length > 1);
  assert.deepEqual(
    duplicateClasses,
    [],
    `Found duplicate top-level classes: ${duplicateClasses.map(([n, l]) => `${n} on lines ${l.join(",")}`).join("; ")}`,
  );
});

test("Static Audit: Bi-directional check between main.js classes and styles.css rules", () => {
  const cssClassRegex = /\.([a-zA-Z0-9_-]+)/g;
  const cssClasses = new Set();
  let match;
  while ((match = cssClassRegex.exec(stylesCss)) !== null) {
    cssClasses.add(match[1]);
  }

  // 1. Check classes emitted in main.js
  const clsRegex = /(?:cls|className):\s*["\x27]([^"\x27]+)["\x27]|(?:addClass|removeClass|toggleClass)\(["\x27]([^"\x27]+)["\x27]\)/g;
  const missingInCss = [];
  while ((match = clsRegex.exec(mainJs)) !== null) {
    const classAttr = match[1] || match[2];
    classAttr.split(/\s+/).forEach((cls) => {
      if (
        cls &&
        (cls.startsWith("launchpad-") || cls.startsWith("now-") || cls.startsWith("crisp-")) &&
        !cls.includes("${") &&
        !cssClasses.has(cls)
      ) {
        missingInCss.push(cls);
      }
    });
  }
  assert.deepEqual(
    missingInCss,
    [],
    `Classes used in main.js but missing in styles.css: ${missingInCss.join(", ")}`,
  );

  // 2. Check unused launchpad-* classes in styles.css
  const deadLaunchpadStyles = [];
  cssClasses.forEach((cls) => {
    if (cls.startsWith("launchpad-") && !mainJs.includes(cls)) {
      deadLaunchpadStyles.push(cls);
    }
  });
  assert.deepEqual(
    deadLaunchpadStyles,
    [],
    `Dead launchpad-* classes defined in styles.css but never used in main.js: ${deadLaunchpadStyles.join(", ")}`,
  );
});

test("Static Audit: helper and mutation callsites pass the required argument shape", () => {
  const lines = mainJs.split(/\r?\n/);
  const mutationApis = /\b(updateNowTask|deleteNowTask|toggleNowTask)\s*\(/;
  const mutationDefinition = /^(?:async\s+)?(updateNowTask|deleteNowTask|toggleNowTask)\s*\(/;
  lines.forEach((line, index) => {
    const trimmed = line.trim();

    // snapshotAge takes a timestamp string (or nothing the wrapper can resolve to one).
    if (line.includes("snapshotAge(") && !line.includes("function snapshotAge")) {
      assert.ok(
        trimmed.includes(".generated_at"),
        `snapshotAge callsite on line ${index + 1} must read …generated_at: ${trimmed}`,
      );
    }

    // Every Now mutation must carry a title anchor so a shifted line cannot hit the wrong task.
    if (!mutationDefinition.test(trimmed) && mutationApis.test(line)) {
      const callStart = line.indexOf("(");
      const args = callStart >= 0 ? line.slice(callStart) : "";
      assert.match(
        args,
        /\w[\w.]*\s*,/,
        `Now mutation callsite on line ${index + 1} must pass a title anchor: ${trimmed}`,
      );
    }
  });
});

// The Hero version subtitle was deliberately removed by the author. It keeps being
// reintroduced by "restore the version line" changes, so pin its absence here.
test("Static Audit: the Hero version subtitle stays removed", () => {
  assert.ok(
    !mainJs.includes("parseHeroVersions"),
    "parseHeroVersions must not be reintroduced",
  );
  assert.ok(
    !mainJs.includes("launchpad-hero-subtitle"),
    "the Hero subtitle must not be rendered",
  );
  assert.ok(
    !stylesCss.includes("launchpad-hero-subtitle"),
    "the Hero subtitle styles must not exist",
  );
});

test("Static Audit: mobile quick capture stacks the content field at full width", () => {
  assert.ok(mainJs.includes('contentSetting.settingEl.addClass("launchpad-quick-content-setting")'));

  const rowRule = stylesCss.match(
    /body\.is-mobile \.crisp-launchpad-quick-modal \.launchpad-quick-content-setting\s*\{[^}]*\}/s,
  )?.[0] || "";
  assert.match(rowRule, /flex-direction:\s*column/);

  const textareaRule = stylesCss.match(
    /body\.is-mobile \.crisp-launchpad-quick-modal \.launchpad-quick-content-setting textarea\s*\{[^}]*\}/s,
  )?.[0] || "";
  assert.match(textareaRule, /width:\s*100%/);
  assert.match(textareaRule, /max-width:\s*none/);
});
