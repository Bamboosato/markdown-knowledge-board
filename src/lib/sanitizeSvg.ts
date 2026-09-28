const DANGEROUS_URL_PATTERN = /^(?:javascript|vbscript):|^data:text\/html/i;

export function sanitizeSvg(svg: string, standalone = false): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.tagName.toLowerCase() !== "svg") {
    throw new Error("SVG could not be parsed safely.");
  }

  document.querySelectorAll("script, foreignObject").forEach((element) => element.remove());
  if (standalone) {
    document.querySelectorAll("style").forEach((element) => {
      if (/@import|url\s*\(\s*(?!#)/i.test(element.textContent ?? "")) element.remove();
    });
  }
  document.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on")) {
        element.removeAttribute(attribute.name);
      } else if (["href", "xlink:href", "src", "action", "formaction"].includes(name) && (
        DANGEROUS_URL_PATTERN.test(value) ||
        (standalone && !value.startsWith("#"))
      )) {
        element.removeAttribute(attribute.name);
      } else if (
        (name === "style" && /url\s*\(|expression\s*\(/i.test(value)) ||
        (standalone && /url\s*\(\s*(?!#)/i.test(value))
      ) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return new XMLSerializer().serializeToString(document.documentElement);
}
