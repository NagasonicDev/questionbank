import type { ContentBlock } from "../api/types";
import * as idb from "./db/indexeddb";
import { contentOf } from "./criteria";
import { renderLatexPng } from "./equations";

export const IMAGE_TYPES = new Set(["image", "diagram", "graph"]);

export function inlineMathExpressions(text: string): string[] {
  return Array.from(text.matchAll(/\$([^$]+)\$/g), (match) => match[1]);
}

export function inlineMathImageId(blockId: string, index: number): string {
  return `${blockId}:inline-math:${index}`;
}

export interface ResolvedImage {
  data: Uint8Array<ArrayBuffer>;
  mime: string;
  widthPx: number;
  heightPx: number;
}

export async function blobPixelSize(
  blob: Blob
): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/** Rasterize an SVG blob to a PNG canvas so document builders can embed it. */
export async function svgToPng(
  blob: Blob
): Promise<{ data: Uint8Array<ArrayBuffer>; width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("svg load failed"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 96;
  canvas.height = img.naturalHeight || 96;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.drawImage(img, 0, 0);
  URL.revokeObjectURL(url);
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas toBlob failed"))), "image/png")
  );
  return {
    data: new Uint8Array(await png.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
}

export async function resolveImages(
  blocks: ContentBlock[]
): Promise<Map<string, ResolvedImage>> {
  const map = new Map<string, ResolvedImage>();
  await Promise.all(blocks.map(async (b) => {
    if (!IMAGE_TYPES.has(b.block_type)) return;
    const path = contentOf(b, "asset_path");
    if (typeof path !== "string" || !path) return;
    const blob = await idb.getAsset(path);
    if (!blob) return;
    let data = new Uint8Array(await blob.arrayBuffer());
    let mime = blob.type || "image/png";
    let size = await blobPixelSize(blob);
    if (mime === "image/svg+xml") {
      const png = await svgToPng(blob);
      data = png.data;
      mime = "image/png";
      size = { w: png.width, h: png.height };
    }
    map.set(b.block_id, {
      data,
      mime,
      widthPx: size ? size.w : 96,
      heightPx: size ? size.h : 96,
    });
  }));
  return map;
}

export async function resolveEquations(
  blocks: ContentBlock[]
): Promise<Map<string, ResolvedImage>> {
  const map = new Map<string, ResolvedImage>();
  const jobs: Array<() => Promise<void>> = [];
  for (const b of blocks) {
    if (b.block_type !== "equation") {
      const texts: string[] = [];
      if (b.block_type === "text" || b.block_type === "heading") {
        const text = contentOf(b, "text");
        if (typeof text === "string") texts.push(text);
      } else if (b.block_type === "table") {
        const columns = contentOf(b, "columns", []);
        const rows = contentOf(b, "rows", []);
        if (Array.isArray(columns)) texts.push(...columns.map(String));
        if (Array.isArray(rows)) {
          for (const row of rows) if (Array.isArray(row)) texts.push(...row.map(String));
        }
      } else if (b.block_type === "list") {
        const items = contentOf(b, "items", []);
        if (Array.isArray(items)) texts.push(...items.map(String));
      }
      const expressions = texts.flatMap(inlineMathExpressions);
      for (let i = 0; i < expressions.length; i++) {
        const expression = expressions[i];
        jobs.push(async () => {
          const png = await renderLatexPng(expression, false);
          if (!png) return;
          const heightPx = 22;
          map.set(inlineMathImageId(b.block_id, i), {
            data: new Uint8Array(png.data),
            mime: "image/png",
            widthPx: Math.max(1, Math.round((png.width / png.height) * heightPx)),
            heightPx,
          });
        });
      }
      continue;
    }
    const latex = contentOf(b, "latex");
    if (typeof latex !== "string" || !latex) continue;
    const display = contentOf(b, "display", true) !== false;
    jobs.push(async () => {
      const png = await renderLatexPng(latex, display);
      if (!png) return;
      const heightPx = 27;
      const widthPx = Math.round((png.width / png.height) * heightPx);
      map.set(b.block_id, {
        data: new Uint8Array(png.data),
        mime: "image/png",
        widthPx,
        heightPx,
      });
    });
  }

  // Keep DOM rasterization concurrent enough to reduce per-equation latency
  // without creating an unbounded number of canvases and cloned DOM trees.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (next < jobs.length) await jobs[next++]();
  }));
  return map;
}
