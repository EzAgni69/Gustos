import { create } from "zustand";

export type TableStatus = "VACANT" | "OCCUPIED" | "BILLED" | "RESERVED";

export interface TableArea {
  id: string;
  name: string;
  tableCount: number;
}

export interface POSTable {
  id: string;
  areaId: string;
  tableNumber: string;
  capacity: number;
  status: TableStatus;
  currentBillAmount?: number;
  assignedWaiter?: string;
  seatedSince?: Date;
  orderNumber?: string;
}

export interface TableStoreState {
  areas: TableArea[];
  tables: POSTable[];
  selectedAreaId: string | null;

  // Actions
  setSelectedArea: (areaId: string | null) => void;
  setTableStatus: (tableId: string, status: TableStatus, billAmount?: number, waiter?: string, orderNumber?: string) => void;
  transferTable: (fromTableId: string, toTableId: string) => void;
}

const MOCK_AREAS: TableArea[] = [
  { id: "SEC-AC", name: "AC Dining Hall", tableCount: 10 },
  { id: "SEC-GD", name: "Open Garden Area", tableCount: 6 },
  { id: "SEC-BR", name: "Bar & Lounge", tableCount: 4 },
];

const MOCK_TABLES: POSTable[] = [
  // AC Section (10 tables)
  { id: "table-ac-1", areaId: "SEC-AC", tableNumber: "T-01 (AC)", capacity: 2, status: "VACANT" },
  { id: "table-ac-2", areaId: "SEC-AC", tableNumber: "T-02 (AC)", capacity: 2, status: "RESERVED" },
  { id: "table-ac-3", areaId: "SEC-AC", tableNumber: "T-03 (AC)", capacity: 4, status: "VACANT" },
  {
    id: "table-ac-4",
    areaId: "SEC-AC",
    tableNumber: "T-04 (AC)",
    capacity: 4,
    status: "OCCUPIED",
    currentBillAmount: 945,
    assignedWaiter: "Capt. Rahul",
    seatedSince: new Date(Date.now() - 32 * 60 * 1000),
    orderNumber: "OUT-20260715-0042",
  },
  { id: "table-ac-5", areaId: "SEC-AC", tableNumber: "T-05 (AC)", capacity: 4, status: "VACANT" },
  {
    id: "table-ac-6",
    areaId: "SEC-AC",
    tableNumber: "T-06 (AC)",
    capacity: 6,
    status: "BILLED",
    currentBillAmount: 2480,
    assignedWaiter: "Capt. Sneha",
    seatedSince: new Date(Date.now() - 65 * 60 * 1000),
    orderNumber: "OUT-20260715-0036",
  },
  { id: "table-ac-7", areaId: "SEC-AC", tableNumber: "T-07 (AC)", capacity: 6, status: "VACANT" },
  { id: "table-ac-8", areaId: "SEC-AC", tableNumber: "T-08 (AC)", capacity: 8, status: "VACANT" },
  {
    id: "table-ac-9",
    areaId: "SEC-AC",
    tableNumber: "T-09 (AC)",
    capacity: 8,
    status: "OCCUPIED",
    currentBillAmount: 3950,
    assignedWaiter: "Capt. Vikram",
    seatedSince: new Date(Date.now() - 48 * 60 * 1000),
    orderNumber: "OUT-20260715-0038",
  },
  { id: "table-ac-10", areaId: "SEC-AC", tableNumber: "T-10 (AC)", capacity: 12, status: "VACANT" },

  // Garden Section (6 tables)
  { id: "table-gd-1", areaId: "SEC-GD", tableNumber: "G-01 (Garden)", capacity: 4, status: "VACANT" },
  { id: "table-gd-2", areaId: "SEC-GD", tableNumber: "G-02 (Garden)", capacity: 4, status: "VACANT" },
  {
    id: "table-gd-3",
    areaId: "SEC-GD",
    tableNumber: "G-03 (Garden)",
    capacity: 6,
    status: "OCCUPIED",
    currentBillAmount: 1820,
    assignedWaiter: "Capt. Sneha",
    seatedSince: new Date(Date.now() - 22 * 60 * 1000),
    orderNumber: "OUT-20260715-0043",
  },
  { id: "table-gd-4", areaId: "SEC-GD", tableNumber: "G-04 (Garden)", capacity: 6, status: "VACANT" },
  { id: "table-gd-5", areaId: "SEC-GD", tableNumber: "G-05 (Garden)", capacity: 8, status: "RESERVED" },
  { id: "table-gd-6", areaId: "SEC-GD", tableNumber: "G-06 (Garden)", capacity: 10, status: "VACANT" },

  // Bar & Lounge (4 tables)
  {
    id: "table-br-1",
    areaId: "SEC-BR",
    tableNumber: "B-01 (Bar)",
    capacity: 2,
    status: "OCCUPIED",
    currentBillAmount: 1450,
    assignedWaiter: "Capt. Vikram",
    seatedSince: new Date(Date.now() - 40 * 60 * 1000),
    orderNumber: "OUT-20260715-0041",
  },
  { id: "table-br-2", areaId: "SEC-BR", tableNumber: "B-02 (Bar)", capacity: 4, status: "VACANT" },
  { id: "table-br-3", areaId: "SEC-BR", tableNumber: "B-03 (Bar)", capacity: 4, status: "VACANT" },
  { id: "table-br-4", areaId: "SEC-BR", tableNumber: "B-04 (Bar)", capacity: 6, status: "VACANT" },
];

export const useTableStore = create<TableStoreState>((set, get) => ({
  areas: MOCK_AREAS,
  tables: MOCK_TABLES,
  selectedAreaId: MOCK_AREAS[0]?.id ?? null,

  setSelectedArea: (areaId) => set({ selectedAreaId: areaId }),

  setTableStatus: (tableId, status, billAmount, waiter, orderNumber) => {
    set({
      tables: get().tables.map((t) =>
        t.id === tableId
          ? {
              ...t,
              status,
              currentBillAmount: billAmount ?? t.currentBillAmount,
              assignedWaiter: waiter ?? t.assignedWaiter,
              seatedSince: status === "OCCUPIED" && t.status !== "OCCUPIED" ? new Date() : t.seatedSince,
              orderNumber: orderNumber ?? t.orderNumber,
            }
          : t
      ),
    });
  },

  transferTable: (fromTableId, toTableId) => {
    const { tables } = get();
    const fromTable = tables.find((t) => t.id === fromTableId);
    if (!fromTable) return;

    set({
      tables: tables.map((t) => {
        if (t.id === fromTableId) {
          return { ...t, status: "VACANT", currentBillAmount: undefined, seatedSince: undefined, orderNumber: undefined };
        }
        if (t.id === toTableId) {
          return {
            ...t,
            status: fromTable.status,
            currentBillAmount: fromTable.currentBillAmount,
            assignedWaiter: fromTable.assignedWaiter,
            seatedSince: fromTable.seatedSince,
            orderNumber: fromTable.orderNumber,
          };
        }
        return t;
      }),
    });
  },
}));
