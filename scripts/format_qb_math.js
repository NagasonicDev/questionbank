// Create a formatted copy of a .qb export. Original bundle is never overwritten.
const fs = require("node:fs");
const path = require("node:path");
const JSZip = require(path.join(__dirname, "..", "frontend", "node_modules", "jszip"));

const input = path.join(__dirname, "..", "Physics.qb");
const output = path.join(__dirname, "..", "Physics_formatted.qb");
const stopWords = /\b(?:with|then|so|and|giving|which|because|when|where|as|for|between|since|the|that|using|while|energy|momentum|gravitational|orbital|inversely|i\.e\.)\b/i;

function latexify(expr) {
  return expr
    .replace(/\blambda_max\b/g, "\\lambda_{\\max}")
    .replace(/\blambda\b/g, "\\lambda")
    .replace(/\btheta\b/g, "\\theta")
    .replace(/\bpi\b/g, "\\pi")
    .replace(/\b([A-Za-z]+)_([A-Za-z0-9]+)\b/g, "$1_{$2}")
    .replace(/\bsin\b/g, "\\sin")
    .replace(/\bcos\b/g, "\\cos")
    .replace(/\btan\b/g, "\\tan")
    .replace(/\bm0\b/g, "m_{0}")
    .replace(/\bsqrt\s*\(([^()]*)\)/g, "\\sqrt{$1}")
    .replace(/\*/g, "\\times ");
}

function formatScientific(text) {
  const unitPattern = "kg\\s*m\\s*s(?:\\^?-?\\d+)?|kg\\s*m/s(?:\\^?\\d+)?|kg/m\\^?\\d+|m/s(?:\\^?\\d+)?|m\\^?\\d+|kg|Hz|lux|Wb|N|J|V|A|T|K|C|s|m|°C";
  const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*[x×]\\s*10\\s*\\^\\s*\\{?(-?\\d+)\\}?(?:\\s*(${unitPattern})(?![A-Za-z]))?`, "g");
  return text.replace(re, (_, coeff, exponent, unit) => {
    const unitLatex = unit === "°C" ? "\\,{}^\\circ\\mathrm{C}" : unit ? `\\,\\mathrm{${unit.replace(/\s+/g, "\\,").replace(/\^(\d+)/g, "^{$1}")}}` : "";
    return `$${coeff}\\times10^{${exponent}}${unitLatex}$`;
  });
}

function formatUnits(text) {
  const unit = "kg\\s*m/s(?:\\^\\d+)?|m/s(?:\\^\\d+)?|kg/m\\^\\d+|m\\^\\d+|mm|nm|kV|cm|kg|Hz|lux|Wb|N|J|V|A|T|K|C|s|m";
  const re = new RegExp(`(\\d+(?:\\.\\d+)?)\\s+(${unit})(?![A-Za-z])`, "g");
  return text.replace(re, (_, value, units) => `$${value}\\,\\mathrm{${units.replace(/\\^(\\d+)/g, "^{$1}")}}$`);
}

function formatEquations(text) {
  // Keep prose intact, wrapping equation spans from variable assignments.
  const re = /\b([A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*)\s*(=|∝|≈)\s*([A-Za-z0-9_{}()+*/^πθλ√= .-]+)/g;
  let out = "";
  let last = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index;
    if (start == null || start < last) continue;
    let rhs = match[3];
    const stop = rhs.search(stopWords);
    if (stop >= 0) rhs = rhs.slice(0, stop);
    rhs = rhs.replace(/[\s,;:.]+$/, "");
    if (!rhs || !/[A-Za-z0-9]/.test(rhs)) continue;
    const consumed = match[0].length - match[3].length + rhs.length;
    out += text.slice(last, start) + `$${latexify(match[1] + " " + match[2] + " " + rhs.trim())}$`;
    last = start + consumed;
  }
  return out ? out + text.slice(last) : text;
}

function cleanText(value) {
  let text = String(value ?? "").replace(/�C/g, "°C").replace(/� graph/g, "— graph");
  // Apply each formatter only to prose; never rewrite a generated LaTeX span.
  const inProse = (transform) => text.split(/(\$[^$]+\$)/g).map((part) =>
    part.startsWith("$") && part.endsWith("$") ? part : transform(part)
  ).join("");
  text = inProse(formatScientific);
  text = inProse(formatUnits);
  const known = [
    [/d sin\(theta\) = m\*lambda/g, "$d\\sin(\\theta) = m\\lambda$"],
    [/d = 1\/\(10 lines\/mm\)/g, "$d = 1/(10\\,\\mathrm{lines/mm})$"],
    [/y = m\*lambda\*L\/d/g, "$y = m\\lambda L/d$"],
    [/r\^3\/T\^2 = GM\/\(4\*pi\^2\)/g, "$r^3/T^2 = GM/(4\\pi^2)$"],
    [/T - mg = mv\^2\/r/g, "$T - mg = mv^2/r$"],
    [/T \+ mg = mv\^2\/r/g, "$T + mg = mv^2/r$"],
    [/V_p\*I_p = V_s\*I_s/g, "$V_p I_p = V_s I_s$"],
    [/U proportional to 1\/r/g, "$U \\propto 1/r$"],
    [/v proportional to 1\/sqrt\(r\)/g, "$v \\propto 1/\\sqrt{r}$"],
    [/sqrt\(5\) V_F = sqrt\(2\) V_E/g, "$\\sqrt{5} V_F = \\sqrt{2} V_E$"],
  ];
  for (const [pattern, replacement] of known) text = text.replace(pattern, replacement);
  text = inProse(formatEquations);
  text = text.replace(/\bm0(?=\s*=)/g, "$m_{0}$");
  text = text.replace(/At the bottom:.*$/, "At the bottom: $T - mg = mv^2/r$, so $T_{\\mathrm{bottom}} = mv^2/r + mg$. At the top: $T + mg = mv^2/r$, so $T_{\\mathrm{top}} = mv^2/r - mg$.");
  return text;
}

function cleanValue(value) {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return value.map(cleanValue);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = cleanValue(value[key]);
  }
  return value;
}

(async () => {
  if (!fs.existsSync(input)) throw new Error(`Missing ${input}`);
  const zip = await JSZip.loadAsync(fs.readFileSync(input));
  const entry = zip.file("course.json");
  if (!entry) throw new Error("Physics.qb has no course.json");
  const course = JSON.parse(await entry.async("string"));
  const counters = { strings: 0, changed: 0, questions: course.questions?.length ?? 0 };
  const visit = (value) => {
    if (typeof value === "string") {
      counters.strings++;
      const next = cleanText(value);
      if (next !== value) counters.changed++;
      return next;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === "object") {
      for (const key of Object.keys(value)) value[key] = visit(value[key]);
    }
    return value;
  };
  visit(course.questions);
  zip.file("course.json", JSON.stringify(course, null, 2));
  fs.writeFileSync(output, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log(JSON.stringify({ output, ...counters }, null, 2));
})();
