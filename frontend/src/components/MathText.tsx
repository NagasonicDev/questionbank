import type { ReactNode } from "react";
import { InlineMath } from "react-katex";

/** Render explicit $...$ math and common legacy scientific notation in text. */
export function MathText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  // Import files predating inline-math guidance commonly use `x 10^n`.
  const source = text.replace(
    /(\d+(?:\.\d+)?)\s*[x×]\s*10\s*\^\s*(-?\d+)(?:\s*(kg\s*m\s*s(?:\^?-?\d+)?|kg|ms\^-?\d+|m|s|N|J|Hz|V|A|T|K|C|Wb|lux|°C))?\b/g,
    (_, coefficient, exponent, unit) => `$${coefficient}\\times10^{${exponent}}${unit ? `\\,\\mathrm{${unit.replace(/\s+/g, "\\,")}}` : ""}$`
  );
  const re = /\$([^$]+)\$/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = re.exec(source))) {
    if (match.index > last) parts.push(source.slice(last, match.index));
    parts.push(<InlineMath key={index++} math={match[1]} errorColor="#b3261e" />);
    last = re.lastIndex;
  }
  if (last < source.length) parts.push(source.slice(last));
  return <>{parts}</>;
}
