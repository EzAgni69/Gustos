/**
 * @gusto/printer — ESC/POS Byte Renderer
 *
 * Converts ReceiptLine[] to ESC/POS command byte sequences
 * that can be sent directly to thermal printers via USB/LAN.
 *
 * Reference: ESC/POS Command Specification (Epson TM series compatible)
 */

import type { ReceiptLine } from "./index.js";

// ─── ESC/POS Command Constants ───

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Initialize printer */
const CMD_INIT = new Uint8Array([ESC, 0x40]);

/** Text alignment */
const ALIGN_LEFT = new Uint8Array([ESC, 0x61, 0x00]);
const ALIGN_CENTER = new Uint8Array([ESC, 0x61, 0x01]);
const ALIGN_RIGHT = new Uint8Array([ESC, 0x61, 0x02]);

/** Bold on/off */
const BOLD_ON = new Uint8Array([ESC, 0x45, 0x01]);
const BOLD_OFF = new Uint8Array([ESC, 0x45, 0x00]);

/** Double-size text (width + height) */
const SIZE_DOUBLE = new Uint8Array([GS, 0x21, 0x11]); // double width + double height
const SIZE_NORMAL = new Uint8Array([GS, 0x21, 0x00]);

/** Paper cut (partial) */
const PAPER_CUT = new Uint8Array([GS, 0x56, 0x41, 0x03]);

/** Feed lines */
const FEED_3 = new Uint8Array([ESC, 0x64, 0x03]);

/** Cash drawer kick (ESC p 0 25 250) */
const DRAWER_KICK = new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xFA]);

/** Default paper width for 80mm thermal paper */
const DEFAULT_WIDTH = 42;

// ─── Helpers ───

const textEncoder = new TextEncoder();

function encodeText(text: string): Uint8Array {
  return textEncoder.encode(text);
}

function newline(): Uint8Array {
  return new Uint8Array([LF]);
}

function concat(...buffers: Uint8Array[]): Uint8Array {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(buf, offset);
    offset += buf.length;
  }
  return result;
}

function alignCmd(align?: "left" | "center" | "right"): Uint8Array {
  switch (align) {
    case "center":
      return ALIGN_CENTER;
    case "right":
      return ALIGN_RIGHT;
    default:
      return ALIGN_LEFT;
  }
}

function buildDivider(width: number): string {
  return "-".repeat(width);
}

function padColumn(text: string, width: number, align?: "left" | "right"): string {
  // Truncate if too long
  const truncated = text.length > width ? text.substring(0, width) : text;
  if (align === "right") {
    return truncated.padStart(width);
  }
  return truncated.padEnd(width);
}

// ─── Main Renderer ───

/**
 * Render ReceiptLine[] to ESC/POS byte commands.
 *
 * @param lines - Array of ReceiptLine objects from template builders
 * @param width - Paper width in characters (default: 42 for 80mm)
 * @returns Uint8Array of ESC/POS commands ready to send to printer
 */
export function renderToEscPos(
  lines: ReceiptLine[],
  width: number = DEFAULT_WIDTH
): Uint8Array {
  const chunks: Uint8Array[] = [];

  // Initialize printer
  chunks.push(CMD_INIT);

  for (const line of lines) {
    switch (line.type) {
      case "divider": {
        chunks.push(ALIGN_LEFT);
        chunks.push(encodeText(buildDivider(width)));
        chunks.push(newline());
        break;
      }

      case "blank": {
        chunks.push(newline());
        break;
      }

      case "image": {
        // Image rendering requires raster bitmap conversion.
        // For now, skip image lines (logo will be added later).
        // The pos-local-server can handle image loading separately
        // via node-thermal-printer's native image support.
        chunks.push(ALIGN_CENTER);
        chunks.push(encodeText("[LOGO]"));
        chunks.push(newline());
        break;
      }

      case "qr": {
        // QR code rendering via GS ( k commands.
        // For production, the pos-local-server should use
        // node-thermal-printer's QR code API.
        if (line.content) {
          chunks.push(ALIGN_CENTER);
          chunks.push(encodeText(`[QR:${line.content}]`));
          chunks.push(newline());
        }
        break;
      }

      case "text": {
        // Set styles
        if (line.bold) chunks.push(BOLD_ON);
        if (line.size === "double") chunks.push(SIZE_DOUBLE);

        if (line.columns && line.columns.length > 0) {
          // Column layout: align left always for the line itself,
          // handle individual column padding
          chunks.push(ALIGN_LEFT);
          const colStr = line.columns
            .map((col) => padColumn(col.text, col.width, col.align))
            .join("");
          chunks.push(encodeText(colStr));
        } else if (line.content !== undefined) {
          chunks.push(alignCmd(line.align));
          chunks.push(encodeText(line.content));
        }

        chunks.push(newline());

        // Reset styles
        if (line.size === "double") chunks.push(SIZE_NORMAL);
        if (line.bold) chunks.push(BOLD_OFF);
        break;
      }
    }
  }

  // Feed and cut
  chunks.push(FEED_3);
  chunks.push(PAPER_CUT);

  return concat(...chunks);
}

/**
 * Convert ESC/POS byte array to a Buffer (Node.js).
 * Useful when sending to USB/LAN printers via node-thermal-printer
 * or raw socket connections.
 */
export function escPosToBuffer(data: Uint8Array): Buffer {
  return Buffer.from(data);
}

/**
 * Generate ESC/POS byte commands to open the cash drawer.
 * Sends the `ESC p 0 25 250` command which pulses the drawer kick-out connector.
 */
export function generateCashDrawerKick(): Uint8Array {
  return DRAWER_KICK;
}

