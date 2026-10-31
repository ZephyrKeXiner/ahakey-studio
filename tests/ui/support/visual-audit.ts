import { expect, type Page } from "@playwright/test";

export async function auditLayout(page: Page, name: string) {
  const problems = await page.evaluate(() => {
    const problems: string[] = [];
    const allowedSizes = new Set([12, 13, 16, 20]);
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      if (!element.checkVisibility({ checkVisibilityCSS: true })) continue;
      const style = getComputedStyle(element);
      const text = Array.from(element.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent)
        .join("")
        .trim();
      if (text && !allowedSizes.has(parseFloat(style.fontSize)))
        problems.push(
          `${element.tagName}: ${style.fontSize} ${text.slice(0, 35)}`,
        );
      if (text && style.fontStyle !== "normal")
        problems.push(`Italic: ${text.slice(0, 35)}`);
      if (/gradient/.test(style.backgroundImage))
        problems.push(`Gradient: ${element.className}`);
      if (element.tagName === "SELECT" && style.appearance !== "none")
        problems.push(`Select arrow: ${element.getAttribute("aria-label")}`);
    }
    for (const element of document.querySelectorAll<HTMLElement>(
      ".dialog-body, .inspector-scroll, .studio-toolbar, .canvas-pane",
    )) {
      if (
        element.checkVisibility() &&
        element.scrollWidth > element.clientWidth + 1
      )
        problems.push(`Horizontal overflow: ${element.className}`);
    }
    if (document.documentElement.scrollWidth > innerWidth)
      problems.push("Page horizontal overflow");
    return problems;
  });
  expect(problems, name).toEqual([]);
  await page.screenshot({ path: `test-results/design-${name}.png` });
}
