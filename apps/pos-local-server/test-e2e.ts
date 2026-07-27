/**
 * E2E Sync Test Script
 * 
 * Simulates a full billing flow hitting the local POS API,
 * then triggers a cloud sync.
 */
import { pushToCloud } from "./src/services/sync.service.js";

async function runTest() {
  const baseUrl = "http://localhost:8080/api";

  console.log("1. Creating order...");
  const createRes = await fetch(`${baseUrl}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-user-id": "user123" },
    body: JSON.stringify({
      orderMode: "DINE_IN",
      tableId: "table-ac-1",
      paxCount: 2,
    }),
  });
  const order = (await createRes.json()).data;
  console.log(`Order created: ${order.orderNumber}`);

  console.log("\n2. Adding items...");
  const addItemsRes = await fetch(`${baseUrl}/orders/${order.id}/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      items: [
        { menuItemId: "item-101", menuItemName: "Paneer Tikka Dry", quantity: 1, unitPrice: 260, gstRate: "5" },
        { menuItemId: "item-401", menuItemName: "Steamed Basmati Rice", quantity: 2, unitPrice: 160, gstRate: "5" },
      ],
    }),
  });
  console.log("Items added.");

  console.log("\n3. Firing KOT...");
  await fetch(`${baseUrl}/orders/${order.id}/kot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  console.log("KOT fired (check POS server console for receipt).");

  console.log("\n4. Checking out...");
  const checkoutRes = await fetch(`${baseUrl}/orders/${order.id}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentMode: "UPI" }),
  });
  const checkoutData = (await checkoutRes.json()).data;
  console.log(`Checkout complete! Total paid: ₹${checkoutData.totalAmount}, Invoice: ${checkoutData.invoiceNumber}`);

  console.log("\n5. Pushing to Cloud...");
  const syncCount = await pushToCloud();
  console.log(`Pushed ${syncCount} events to cloud via API Gateway.`);
}

runTest().catch(console.error);
