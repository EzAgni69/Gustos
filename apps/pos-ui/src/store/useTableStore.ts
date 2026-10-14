import { create } from "zustand";
import { db } from "../lib/db";

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
  lockedBy?: string;
}

export interface TableStoreState {
  areas: TableArea[];
  tables: POSTable[];
  selectedAreaId: string | null;

  // Actions
  setSelectedArea: (areaId: string | null) => void;
  setTableStatus: (tableId: string, status: TableStatus, billAmount?: number, waiter?: string, orderNumber?: string) => void;
  setTableLock: (tableId: string, lockedBy?: string) => void;
  transferTable: (fromTableId: string, toTableId: string) => void;
  fetchTables: () => Promise<void>;
}



function normalizeTableStatus(status: unknown): TableStatus {
  if (status === "AVAILABLE" || status === "VACANT") return "VACANT";
  if (status === "OCCUPIED" || status === "BILLED" || status === "RESERVED") return status;
  return "VACANT";
}

export const useTableStore = create<TableStoreState>((set, get) => ({
  areas: [],
  tables: [],
  selectedAreaId: null,

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

  setTableLock: (tableId, lockedBy) => {
    set({
      tables: get().tables.map((t) =>
        t.id === tableId ? { ...t, lockedBy } : t
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

  fetchTables: async () => {
    try {
      // 1. Load from IndexedDB
      const cachedAreas = await db.areas.toArray();
      const cachedTables = await db.posTables.toArray();
      if (cachedAreas.length > 0 && cachedTables.length > 0) {
        set({
          areas: cachedAreas,
          tables: cachedTables,
          selectedAreaId: get().selectedAreaId || cachedAreas[0]?.id
        });
      }

      // 2. Fetch from network
      const { apiClient } = await import("../api/client");
      const res = await apiClient<{ success: boolean; data: any[] }>("/tables").catch(() => null);
      
      if (res?.success) {
        const backendTables = res.data;
        
        // Map backend tables to POSTable
        const tables: POSTable[] = backendTables.map(t => ({
          id: t.id,
          areaId: t.section || "DEFAULT",
          tableNumber: t.name,
          capacity: t.capacity,
          status: normalizeTableStatus(t.status),
          currentBillAmount: t.currentOrder?.totalAmount,
          assignedWaiter: t.currentOrder?.waiterName,
          seatedSince: t.currentOrder ? new Date(t.currentOrder.createdAt) : undefined,
          orderNumber: t.currentOrder?.orderNumber,
        }));

        // Deduce areas from tables
        const areaMap = new Map<string, TableArea>();
        tables.forEach(t => {
          if (!areaMap.has(t.areaId)) {
            areaMap.set(t.areaId, {
              id: t.areaId,
              name: t.areaId === "DEFAULT" ? "Main Area" : t.areaId,
              tableCount: 0
            });
          }
          areaMap.get(t.areaId)!.tableCount += 1;
        });

        const areas = Array.from(areaMap.values());
        
        await db.transaction('rw', db.areas, db.posTables, async () => {
          await db.areas.clear();
          await db.areas.bulkAdd(areas);
          await db.posTables.clear();
          await db.posTables.bulkAdd(tables);
        });

        set({
          tables,
          areas,
          selectedAreaId: get().selectedAreaId || (areas.length > 0 ? areas[0]?.id : null),
        });
      }
    } catch (err) {
      console.error("Failed to fetch tables", err);
    }
  },
}));
