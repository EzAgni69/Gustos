/**
 * Gustos ERP — PDF Invoice Generator
 *
 * Generates GST-compliant tax invoices as PDF buffers using pdfmake.
 * Includes restaurant branding, itemized list, CGST/SGST breakup,
 * and payment details.
 */

// @ts-nocheck — pdfmake types are for client-side; server-side API differs slightly
import pdfmake from "pdfmake/build/pdfmake.js";
import type { TDocumentDefinitions, Content } from "pdfmake/interfaces.js";

export interface InvoicePdfData {
  // Organization
  orgName: string;
  orgGstNumber?: string | null;

  // Outlet
  outletName: string;
  outletAddress: string;
  outletPhone?: string | null;
  outletGstNumber?: string | null;
  outletFssaiNo?: string | null;

  // Invoice
  invoiceNumber: string;
  invoiceDate: string; // formatted date string
  receiptStatus: string;

  // Order
  orderNumber: string;
  orderMode: string;
  tableName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  waiterName?: string | null;
  cashierName?: string | null;
  paxCount?: number;

  // Items
  items: {
    name: string;
    variantName?: string | null;
    quantity: number;
    unitPrice: number;
    gstRate: string;
    modifiers: string[];
    total: number;
  }[];

  // Totals
  subtotal: number;
  discountAmount: number;
  discountLabel?: string | null;
  cgstRate: number;
  cgstAmount: number;
  sgstRate: number;
  sgstAmount: number;
  totalQuantity: number;
  totalAmount: number;
  roundOff?: number;

  // Payment
  paymentMode: string;
  paymentSubMethod?: string | null;
  isPaid: boolean;
}

/**
 * Generate a PDF invoice buffer from invoice data.
 */
export async function generateInvoicePdf(
  data: InvoicePdfData
): Promise<Buffer> {
  const content: Content[] = [];

  // ─── Header ───
  content.push(
    {
      text: data.orgName,
      fontSize: 16,
      bold: true,
      color: "#111827",
      alignment: "center" as const,
    },
    {
      text: data.outletName,
      fontSize: 11,
      color: "#374151",
      alignment: "center" as const,
      margin: [0, 2, 0, 0] as [number, number, number, number],
    },
    {
      text: data.outletAddress,
      fontSize: 8,
      color: "#6b7280",
      alignment: "center" as const,
      margin: [0, 2, 0, 0] as [number, number, number, number],
    }
  );

  // Phone
  if (data.outletPhone) {
    content.push({
      text: `Phone: ${data.outletPhone}`,
      fontSize: 8,
      color: "#6b7280",
      alignment: "center" as const,
    });
  }

  // GSTIN
  const gstNumber = data.outletGstNumber || data.orgGstNumber;
  if (gstNumber) {
    content.push({
      text: `GSTIN: ${gstNumber}`,
      fontSize: 8,
      color: "#6b7280",
      alignment: "center" as const,
      margin: [0, 0, 0, 2] as [number, number, number, number],
    });
  }

  // FSSAI
  if (data.outletFssaiNo) {
    content.push({
      text: `FSSAI: ${data.outletFssaiNo}`,
      fontSize: 8,
      color: "#6b7280",
      alignment: "center" as const,
    });
  }

  // Divider
  content.push({
    canvas: [
      {
        type: "line" as const,
        x1: 0,
        y1: 0,
        x2: 370,
        y2: 0,
        lineWidth: 0.5,
        lineColor: "#cccccc",
      },
    ],
    margin: [0, 8, 0, 8] as [number, number, number, number],
  });

  // ─── Invoice Details ───
  content.push({
    columns: [
      {
        width: "50%",
        stack: [
          { text: `Invoice: ${data.invoiceNumber}`, fontSize: 9, color: "#374151" },
          { text: `Order: ${data.orderNumber}`, fontSize: 9, color: "#374151" },
          { text: `Type: ${data.orderMode.replace(/_/g, " ")}`, fontSize: 9, color: "#374151" },
          ...(data.tableName
            ? [{ text: `Table: ${data.tableName}`, fontSize: 9 as const, color: "#374151" as const }]
            : []),
        ],
      },
      {
        width: "50%",
        stack: [
          {
            text: `Date: ${data.invoiceDate}`,
            fontSize: 9,
            color: "#374151",
            alignment: "right" as const,
          },
          {
            text: `Status: ${data.receiptStatus}`,
            fontSize: 9,
            color: "#374151",
            alignment: "right" as const,
          },
          ...(data.waiterName
            ? [
                {
                  text: `Waiter: ${data.waiterName}`,
                  fontSize: 9 as const,
                  color: "#374151" as const,
                  alignment: "right" as const,
                },
              ]
            : []),
          ...(data.cashierName
            ? [
                {
                  text: `Cashier: ${data.cashierName}`,
                  fontSize: 9 as const,
                  color: "#374151" as const,
                  alignment: "right" as const,
                },
              ]
            : []),
        ],
      },
    ],
    margin: [0, 0, 0, 4] as [number, number, number, number],
  });

  // Customer info
  if (data.customerName || data.customerPhone) {
    content.push({
      text: `Customer: ${[data.customerName, data.customerPhone].filter(Boolean).join(" · ")}`,
      fontSize: 9,
      color: "#374151",
      margin: [0, 0, 0, 4] as [number, number, number, number],
    });
  }

  // Divider
  content.push({
    canvas: [
      {
        type: "line" as const,
        x1: 0,
        y1: 0,
        x2: 370,
        y2: 0,
        lineWidth: 0.5,
        lineColor: "#cccccc",
      },
    ],
    margin: [0, 4, 0, 8] as [number, number, number, number],
  });

  // ─── Items Table ───
  const tableBody: any[][] = [
    [
      { text: "#", bold: true, fontSize: 8, color: "#374151", fillColor: "#f3f4f6" },
      { text: "Item", bold: true, fontSize: 8, color: "#374151", fillColor: "#f3f4f6" },
      { text: "Qty", bold: true, fontSize: 8, color: "#374151", alignment: "center", fillColor: "#f3f4f6" },
      { text: "Rate", bold: true, fontSize: 8, color: "#374151", alignment: "right", fillColor: "#f3f4f6" },
      { text: "GST%", bold: true, fontSize: 8, color: "#374151", alignment: "center", fillColor: "#f3f4f6" },
      { text: "Amount", bold: true, fontSize: 8, color: "#374151", alignment: "right", fillColor: "#f3f4f6" },
    ],
  ];

  data.items.forEach((item, idx) => {
    const itemName =
      item.variantName
        ? `${item.name} (${item.variantName})`
        : item.name;

    const row: any[] = [
      { text: String(idx + 1), fontSize: 8 },
      {
        stack: [
          { text: itemName, fontSize: 8 },
          ...(item.modifiers.length > 0
            ? [{ text: item.modifiers.join(", "), fontSize: 7, color: "#6b7280", italics: true }]
            : []),
        ],
      },
      { text: String(item.quantity), fontSize: 8, alignment: "center" },
      { text: `₹${item.unitPrice.toFixed(2)}`, fontSize: 8, alignment: "right" },
      { text: `${item.gstRate}%`, fontSize: 8, alignment: "center" },
      { text: `₹${item.total.toFixed(2)}`, fontSize: 8, alignment: "right" },
    ];

    tableBody.push(row);
  });

  content.push({
    table: {
      headerRows: 1,
      widths: [20, "*", 30, 60, 35, 70],
      body: tableBody,
    },
    layout: {
      hLineWidth: (i: number, node: any) =>
        i === 0 || i === 1 || i === node.table.body.length ? 0.5 : 0,
      vLineWidth: () => 0,
      hLineColor: () => "#cccccc",
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 0, 0, 8] as [number, number, number, number],
  });

  // ─── Totals ───
  const totalsRows: any[][] = [
    [
      { text: "Subtotal", fontSize: 9, color: "#374151" },
      { text: `₹${data.subtotal.toFixed(2)}`, fontSize: 9, alignment: "right" },
    ],
  ];

  if (data.discountAmount > 0) {
    totalsRows.push([
      {
        text: `Discount${data.discountLabel ? ` (${data.discountLabel})` : ""}`,
        fontSize: 9,
        color: "#059669",
      },
      {
        text: `-₹${data.discountAmount.toFixed(2)}`,
        fontSize: 9,
        alignment: "right",
        color: "#059669",
      },
    ]);
  }

  totalsRows.push(
    [
      { text: `CGST @ ${data.cgstRate}%`, fontSize: 9, color: "#374151" },
      { text: `₹${data.cgstAmount.toFixed(2)}`, fontSize: 9, alignment: "right" },
    ],
    [
      { text: `SGST @ ${data.sgstRate}%`, fontSize: 9, color: "#374151" },
      { text: `₹${data.sgstAmount.toFixed(2)}`, fontSize: 9, alignment: "right" },
    ]
  );

  if (data.roundOff && data.roundOff !== 0) {
    totalsRows.push([
      { text: "Round Off", fontSize: 9, color: "#374151" },
      { text: `₹${data.roundOff.toFixed(2)}`, fontSize: 9, alignment: "right" },
    ]);
  }

  totalsRows.push([
    { text: "GRAND TOTAL", fontSize: 11, bold: true, color: "#111827" },
    { text: `₹${data.totalAmount.toFixed(2)}`, fontSize: 11, bold: true, alignment: "right", color: "#111827" },
  ]);

  content.push({
    columns: [
      { width: "*", text: "" },
      {
        width: 220,
        table: {
          widths: ["*", 80],
          body: totalsRows,
        },
        layout: "noBorders",
      },
    ],
    margin: [0, 0, 0, 8] as [number, number, number, number],
  });

  // ─── Payment Info ───
  const paymentText = data.paymentSubMethod
    ? `${data.paymentMode} (${data.paymentSubMethod})`
    : data.paymentMode;

  content.push({
    canvas: [
      {
        type: "line" as const,
        x1: 0,
        y1: 0,
        x2: 370,
        y2: 0,
        lineWidth: 0.5,
        lineColor: "#cccccc",
      },
    ],
    margin: [0, 0, 0, 8] as [number, number, number, number],
  });

  content.push({
    columns: [
      { text: `Payment: ${paymentText}`, fontSize: 9, color: "#374151" },
      {
        text: data.isPaid ? "✓ PAID" : "UNPAID",
        fontSize: 9,
        alignment: "right" as const,
        bold: true,
        color: data.isPaid ? "#059669" : "#dc2626",
      },
    ],
    margin: [0, 0, 0, 4] as [number, number, number, number],
  });

  content.push(
    {
      text: `Total Items: ${data.totalQuantity} · Guests: ${data.paxCount || 1}`,
      fontSize: 8,
      color: "#6b7280",
      margin: [0, 0, 0, 12] as [number, number, number, number],
    }
  );

  // ─── Footer ───
  content.push(
    {
      text: "Thank you for dining with us!",
      fontSize: 8,
      alignment: "center" as const,
      bold: true,
      color: "#6b7280",
      margin: [0, 8, 0, 2] as [number, number, number, number],
    },
    {
      text: `Generated by Gustos ERP · ${new Date().toISOString().split("T")[0]}`,
      fontSize: 7,
      color: "#9ca3af",
      alignment: "center" as const,
    }
  );

  // ─── Document Definition ───
  const docDefinition: TDocumentDefinitions = {
    pageSize: "A5",
    pageMargins: [30, 30, 30, 30],
    content,
    defaultStyle: { font: "Roboto" },
  };

  // ─── Generate Buffer ───
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const pdfDoc = pdfmake.createPdf(docDefinition);
      pdfDoc.getBuffer((buffer: any) => {
        resolve(Buffer.from(buffer));
      });
    } catch (err) {
      reject(err);
    }
  });
}
