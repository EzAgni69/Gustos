import { useEffect } from "react";
import { useCartStore } from "../store/useCartStore";
import { useMenuStore } from "../store/useMenuStore";
import { useUIStore } from "../store/useUIStore";

export function useKeyboardShortcuts() {
  const { items, holdCurrentBill } = useCartStore();
  const { categories, setSelectedCategory, resetSearch } = useMenuStore();
  const { activeView, activeModal, setActiveView, openModal, closeModal, showNotification } =
    useUIStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow normal typing when input/textarea focused, EXCEPT for F-keys and Alt combinations
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl &&
        (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.tagName === "SELECT");

      // ─── Escape: Close modal or blur/reset search ───
      if (e.key === "Escape") {
        if (activeModal !== "NONE") {
          e.preventDefault();
          closeModal();
          return;
        }
        if (isInputFocused) {
          (activeEl as HTMLElement).blur();
          resetSearch();
          return;
        }
      }

      // If typing inside an input and no Alt/F-key pressed, let standard typing work
      if (isInputFocused && !e.altKey && !e.ctrlKey && !e.key.startsWith("F")) {
        return;
      }

      // ─── F1 / Alt+K : Fire KOT ───
      if (e.key === "F1" || (e.altKey && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        if (items.length === 0) {
          showNotification("⚠️ Cart is empty. Add items before printing KOT.");
          return;
        }
        showNotification("🖨️ KOT Fired! Sent to Kitchen Display & Thermal Printer.");
        return;
      }

      // ─── F2 / Alt+S : Focus Search & Short-Code Input ───
      if (e.key === "F2" || (e.altKey && e.key.toLowerCase() === "s")) {
        e.preventDefault();
        const searchInput = document.getElementById("pos-search-input") as HTMLInputElement | null;
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // ─── F3 / Alt+H : Hold Bill / Retrieve Held Bill ───
      if (e.key === "F3" || (e.altKey && e.key.toLowerCase() === "h")) {
        e.preventDefault();
        if (activeModal === "HOLD_BILLS") {
          closeModal();
          return;
        }
        if (items.length > 0) {
          holdCurrentBill("Customer parked bill (F3)");
          showNotification("⏸️ Order parked on hold. Screen cleared for next customer.");
        } else {
          openModal("HOLD_BILLS");
        }
        return;
      }

      // ─── F4 / Alt+Z : Apply Discount ───
      if (e.key === "F4" || (e.altKey && e.key.toLowerCase() === "z")) {
        e.preventDefault();
        if (activeModal === "DISCOUNT") closeModal();
        else openModal("DISCOUNT");
        return;
      }

      // ─── F5 / Alt+T : Toggle Tables Area Grid View ───
      if (e.key === "F5" || (e.altKey && e.key.toLowerCase() === "t")) {
        e.preventDefault();
        const nextView = activeView === "BILLING" ? "TABLES" : "BILLING";
        setActiveView(nextView);
        showNotification(nextView === "TABLES" ? "📍 Floor & Table Map Mode" : "🧾 Billing Counter Mode");
        return;
      }

      // ─── F6 / Alt+P : Split Bill Modal ───
      if (e.key === "F6" || (e.altKey && e.key.toLowerCase() === "p")) {
        e.preventDefault();
        if (activeModal === "SPLIT_BILL") closeModal();
        else if (items.length > 0) openModal("SPLIT_BILL");
        else showNotification("⚠️ Add items to bill before splitting.");
        return;
      }

      // ─── F8 / Alt+O : Open Item / Misc Charge ───
      if (e.key === "F8" || (e.altKey && e.key.toLowerCase() === "o")) {
        e.preventDefault();
        if (activeModal === "OPEN_ITEM") closeModal();
        else openModal("OPEN_ITEM");
        return;
      }

      // ─── F9 / Alt+L : Customer Info / CRM & Loyalty ───
      if (e.key === "F9" || (e.altKey && e.key.toLowerCase() === "l")) {
        e.preventDefault();
        if (activeModal === "CUSTOMER") closeModal();
        else openModal("CUSTOMER");
        return;
      }

      // ─── F12 / Ctrl+Enter : Settle & Pay (Payment Modal) ───
      if (e.key === "F12" || (e.ctrlKey && e.key === "Enter")) {
        e.preventDefault();
        if (items.length === 0) {
          showNotification("⚠️ Cart is empty. Cannot open settlement screen.");
          return;
        }
        if (activeModal === "PAYMENT") closeModal();
        else openModal("PAYMENT");
        return;
      }

      // ─── Alt + Numeric (1-9): Jump to Category ───
      if (e.altKey && !isNaN(Number(e.key)) && e.key !== "0" && e.key !== " ") {
        const index = Number(e.key) - 1;
        if (index >= 0 && index < categories.length) {
          e.preventDefault();
          const targetCat = categories[index];
          if (targetCat) {
            setSelectedCategory(targetCat.id);
            showNotification(`📁 Category: [${index + 1}] ${targetCat.name}`);
          }
        }
        return;
      }

      // ─── Alt+D / Alt+X / Alt+V : Order Mode Switching ───
      if (e.altKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        useCartStore.getState().setOrderMode("DINE_IN");
        showNotification("🍽️ Mode switched: Dine-In");
      }
      if (e.altKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        useCartStore.getState().setOrderMode("TAKEAWAY");
        showNotification("🛍️ Mode switched: Takeaway / Pick-up");
      }
      if (e.altKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        useCartStore.getState().setOrderMode("DELIVERY");
        showNotification("🛵 Mode switched: Online Delivery");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items, activeView, activeModal, categories, holdCurrentBill, setSelectedCategory, resetSearch, setActiveView, openModal, closeModal, showNotification]);
}
