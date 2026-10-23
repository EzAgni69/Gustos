import { useEffect } from "react";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useUIStore } from "./store/useUIStore";
import { useAuthStore } from "./store/useAuthStore";
import { useMenuStore } from "./store/useMenuStore";
import { useTableStore } from "./store/useTableStore";
import { useShiftStore } from "./store/useShiftStore";
import { TopNav } from "./components/layout/TopNav";
import { BottomToolbar } from "./components/layout/BottomToolbar";
import { CategorySidebar } from "./components/billing/CategorySidebar";
import { MenuItemGrid } from "./components/billing/MenuItemGrid";
import { OrderCart } from "./components/billing/OrderCart";
import { PaymentModal } from "./components/modals/PaymentModal";
import { TableMapView } from "./components/modals/TableMapView";
import { HoldBillsModal } from "./components/modals/HoldBillsModal";
import { ModifiersModal } from "./components/modals/ModifiersModal";
import { CustomerModal } from "./components/modals/CustomerModal";
import { DiscountModal } from "./components/modals/DiscountModal";
import { OpenItemModal } from "./components/modals/OpenItemModal";
import { SplitBillModal } from "./components/modals/SplitBillModal";
import { ShiftManagementModal } from "./components/modals/ShiftManagementModal";
import { PrinterStatusModal } from "./components/modals/PrinterStatusModal";
import { SyncQueueModal } from "./components/modals/SyncQueueModal";
import { BillPreviewModal } from "./components/modals/BillPreviewModal";
import { OnlineOrderModal } from "./components/modals/OnlineOrderModal";
import { ItemCustomizerModal } from "./components/modals/ItemCustomizerModal";
import { VoidItemModal } from "./components/modals/VoidItemModal";
import { LoginScreen } from "./components/auth/LoginScreen";
import { useSocket } from "./hooks/useSocket";
import { useOfflineSync } from "./hooks/useOfflineSync";

export function App() {
  const { isAuthenticated } = useAuthStore();
  
  // Activate global Petpooja F-Key shortcuts listener
  useKeyboardShortcuts();
  useSocket();
  useOfflineSync();

  const { activeView, setOnlineStatus } = useUIStore();
  const { fetchMenu } = useMenuStore();
  const { fetchTables } = useTableStore();
  const { fetchActiveShift, fetchShiftWarning } = useShiftStore();

  // Check socket/connection status on boot
  useEffect(() => {
    fetchMenu();
    fetchTables();
    fetchActiveShift();
    fetchShiftWarning();
  }, [fetchMenu, fetchTables, fetchActiveShift, fetchShiftWarning]);

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gray-950 font-sans text-gray-100 select-none">
      {/* Top Header Bar */}
      <TopNav />

      {/* Main Content Area (Billing or Tables View + Right Hand Cart) */}
      <div className="flex-1 flex overflow-hidden relative">
        {activeView === "BILLING" ? (
          <>
            {/* Left Category Jump Sidebar */}
            <CategorySidebar />
            {/* Center High-Speed Item Selection Grid */}
            <MenuItemGrid />
          </>
        ) : (
          /* Floor & Table Map Mode */
          <TableMapView />
        )}

        {/* Right-Hand Petpooja Signature Billing Box (Always accessible) */}
        <OrderCart />
      </div>

      {/* Fixed Bottom Ribbon with all F-Key Shortcuts */}
      <BottomToolbar />

      {/* ─── Operational & Settlement Modals ─── */}
      <PaymentModal />
      <HoldBillsModal />
      <ModifiersModal />
      <CustomerModal />
      <DiscountModal />
      <OpenItemModal />
      <SplitBillModal />
      <ShiftManagementModal />
      <PrinterStatusModal />
      <SyncQueueModal />
      <BillPreviewModal />
      <OnlineOrderModal />
      <ItemCustomizerModal />
      <VoidItemModal />
    </div>
  );
}

export default App;
