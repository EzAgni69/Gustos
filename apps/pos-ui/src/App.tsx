import { useEffect } from "react";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useUIStore } from "./store/useUIStore";
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

export function App() {
  // Activate global Petpooja F-Key shortcuts listener
  useKeyboardShortcuts();

  const { activeView, setOnlineStatus } = useUIStore();

  // Check socket/connection status on boot
  useEffect(() => {
    // We are running local server offline-first mode (zero latency)
    setOnlineStatus(false);
  }, [setOnlineStatus]);

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
    </div>
  );
}

export default App;
