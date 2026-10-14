import Dexie, { type Table } from "dexie";
import type { POSMenuItem, MenuCategory } from "../store/useMenuStore";
import type { POSTable, TableArea } from "../store/useTableStore";

export interface SyncQueueItem {
  id?: number; // Auto-incremented primary key
  action: "CREATE_ORDER" | "UPDATE_ITEMS" | "HOLD_ORDER" | "CHECKOUT" | "FIRE_KOT";
  orderId?: string; // If applicable
  payload: any;
  status: "PENDING" | "FAILED";
  createdAt: string;
  error?: string;
  retryCount: number;
}

export class POSDatabase extends Dexie {
  menuItems!: Table<POSMenuItem, string>;
  menuCategories!: Table<MenuCategory, string>;
  posTables!: Table<POSTable, string>;
  areas!: Table<TableArea, string>;
  syncQueue!: Table<SyncQueueItem, number>;

  constructor() {
    super("pos_local_db");
    
    // Define tables and indexes
    this.version(1).stores({
      menuItems: "id, categoryId, shortCode, name",
      menuCategories: "id, sortOrder",
      posTables: "id, areaId, status",
      areas: "id",
      syncQueue: "++id, action, status, createdAt"
    });
  }
}

export const db = new POSDatabase();
