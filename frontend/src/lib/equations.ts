import "katex/dist/katex.min.css";
import katex from "katex";
import { toBlob } from "html-to-image";

export interface RenderedEquation {
  data: Uint8Array;
  width: number;
  height: number;
}

let holder: HTMLDivElement | null = null;

function getHolder(): HTMLDivElement {
  if (!holder) {
    holder = document.createElement("div");
    holder.style.position = "fixed";
    holder.style.left = "-99999px";
    holder.style.top = "0";
    holder.style.visibility = "hidden";
    holder.style.pointerEvents = "none";
    document.body.appendChild(holder);
  }
  return holder;
}

async function fontsReady(): Promise<void> {
  try {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 50));
}

/**
 * Client-side twin of the backend matplotlib mathtext renderer: LeTeX ->
 * KaTeX -> offscreen DOM -> transparent PNG via html-to-image.
 */
export async function renderLatexPng(
  latex: string,
  display = true
): Promise<RenderedEquation | null> {
  const wrap = document.createElement("div");
  wrap.style.display = "inline-block";
  wrap.style.lineHeight = "normal";
  wrap.style.background = "transparent";
  try {
    katex.render(latex, wrap, { throwOnError: false, displayMode: display });
    const holder = getHolder();
    holder.replaceChildren(wrap);
    await fontsReady();
    const rect = wrap.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(rect.width));
    const height = Math.max(1, Math.ceil(rect.height));
    const blob = await toBlob(wrap, { pixelRatio: 2 });
    if (!blob) return null;
    return {
      data: new Uint8Array(await blob.arrayBuffer()),
      width,
      height,
    };
  } catch {
    return null;
  } finally {
    const h = getHolder();
    h.replaceChildren();
  }
}