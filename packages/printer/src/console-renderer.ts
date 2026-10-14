/**
 * @gusto/printer — Console Renderer
 *
 * Converts ReceiptLine[] to a formatted string for console output.
 * Replaces the duplicated inline rendering loops in pos-local-server.
 */

import type { ReceiptLine } from "./index.js";

/** Default paper width for 80mm thermal paper */
const DEFAULT_WIDTH = 42;

/**
 * Render ReceiptLine[] to a formatted console-friendly string.
 *
 * @param lines - Array of ReceiptLine objects from a template builder
 * @param width - Paper width in characters (default: 42 for 80mm)
 * @returns Formatted string ready for console.log()
 */
export function renderToConsole(
  lines: ReceiptLine[],
  width: number = DEFAULT_WIDTH
): string {
  const output: string[] = [];

  for (const line of lines) {
    switch (line.type) {
      case "divider":
        output.push("─".repeat(width));
        break;

      case "blank":
        output.push("");
        break;

      case "image":
        output.push(`[IMAGE: ${line.imagePath ?? "logo"}]`);
        break;

      case "qr":
        output.push(`[QR: ${line.content ?? ""}]`);
        break;

      case "text": {
        if (line.columns && line.columns.length > 0) {
          // Column layout — pad each column to its width
          const colStr = line.columns
            .map((col) => {
              if (col.align === "right") {
                return col.text.padStart(col.width);
              }
              return col.text.padEnd(col.width);
            })
            .join("");
          output.push(colStr);
        } else if (line.content !== undefined) {
          // Simple text with alignment
          const text = line.content;
          if (line.align === "center") {
            const pad = Math.max(0, Math.floor((width - text.length) / 2));
            output.push(" ".repeat(pad) + text);
          } else if (line.align === "right") {
            output.push(text.padStart(width));
          } else {
            output.push(text);
          }
        }
        break;
      }
    }
  }

  return output.join("\n");
}
