import "katex/dist/katex.min.css";
import katex from "katex";
import { toBlob } from "html-to-image";

export interface RenderedEquation {
  data: Uint8Array;
  width: number;
  height: number;
}

let fontsReadyPromise: Promise<void> | null = null;
const renderedEquations = new Map<string, Promise<RenderedEquation | null>>();
const MAX_EQUATION_CACHE = 256;

function fontsReady(): Promise<void> {
  if (!fontsReadyPromise) {
    fontsReadyPromise = (async () => {
      try {
        if (document.fonts?.ready) await document.fonts.ready;
      } catch {
        /* ignore */
      }
    })();
  }
  return fontsReadyPromise;
}

/**
 * Client-side twin of the backend matplotlib mathtext renderer: LeTeX ->
 * KaTeX -> offscreen DOM -> transparent PNG via html-to-image.
 */
export async function renderLatexPng(
  latex: string,
  display = true
): Promise<RenderedEquation | null> {
  const cacheKey = `${display ? "display" : "inline"}:${latex}`;
  const cached = renderedEquations.get(cacheKey);
  if (cached) return cached;

  const render = renderLatexPngUncached(latex, display);
  renderedEquations.set(cacheKey, render);
  if (renderedEquations.size > MAX_EQUATION_CACHE) {
    const oldest = renderedEquations.keys().next().value;
    if (oldest !== undefined && oldest !== cacheKey) renderedEquations.delete(oldest);
  }
  // Failed renders should be retryable rather than cached permanently.
  void render.then((result) => {
    if (!result && renderedEquations.get(cacheKey) === render) renderedEquations.delete(cacheKey);
  });
  return render;
}

async function renderLatexPngUncached(
  latex: string,
  display: boolean
): Promise<RenderedEquation | null> {
  const wrap = document.createElement("div");
  wrap.style.display = "inline-block";
  wrap.style.lineHeight = "normal";
  wrap.style.background = "transparent";
  wrap.style.color = "#000000";
  const holder = document.createElement("div");
  holder.style.position = "fixed";
  holder.style.left = "-99999px";
  holder.style.top = "0";
  holder.style.visibility = "visible";
  holder.style.pointerEvents = "none";
  holder.appendChild(wrap);
  document.body.appendChild(holder);
  try {
    katex.render(latex, wrap, { throwOnError: false, displayMode: display });
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
    holder.remove();
  }
}
