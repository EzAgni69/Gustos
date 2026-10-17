#!/usr/bin/env bash
set -e

# ==============================================================================
# Gusto ERP — Client Dry Run Testing Package Generator
# Builds and packages:
#   1. Gusto POS Desktop & Local Server (with embedded POS UI + KDS TV + SQLite)
#   2. Gusto KDS TV (Web Standalone + Android TV bundle)
#   3. Gusto Captain App (Expo Go launcher + EAS APK instructions)
# ==============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist-packages"

echo "=========================================="
echo "📦 Generating Client Distribution Packages"
echo "=========================================="
echo "Working directory: $ROOT_DIR"
echo "Output directory:  $DIST_DIR"
echo ""

# 1. Clean and create output directory
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/gusto-pos-desktop/data"
mkdir -p "$DIST_DIR/gusto-pos-desktop/public/pos"
mkdir -p "$DIST_DIR/gusto-pos-desktop/public/kds"
mkdir -p "$DIST_DIR/gusto-kds/web"
mkdir -p "$DIST_DIR/gusto-captain"

# 2. Build shared packages and apps
echo "🔨 Step 1: Building production bundles via Turborepo..."
cd "$ROOT_DIR"
pnpm turbo run build --filter=@gusto/api-contracts... --filter=@gusto/core-logic... --filter=@gusto/db-schema... --filter=@gusto/printer...
pnpm turbo run build --filter=@gusto/pos-ui...
pnpm turbo run build --filter=@gusto/kds-tv...
pnpm turbo run build --filter=@gusto/pos-local-server...

# 3. Copy built frontends to POS server static directory
echo "📂 Step 2: Copying frontends into POS Desktop package..."
cp -R "$ROOT_DIR/apps/pos-ui/dist/"* "$DIST_DIR/gusto-pos-desktop/public/pos/"
cp -R "$ROOT_DIR/apps/kds-tv/dist/"* "$DIST_DIR/gusto-pos-desktop/public/kds/"

# Also copy KDS standalone web distribution
cp -R "$ROOT_DIR/apps/kds-tv/dist/"* "$DIST_DIR/gusto-kds/web/"

# 4. Copy pre-seeded SQLite database
echo "💾 Step 3: Copying pre-seeded local database..."
if [ -f "$ROOT_DIR/apps/pos-local-server/data/local.sqlite" ]; then
  cp "$ROOT_DIR/apps/pos-local-server/data/local.sqlite" "$DIST_DIR/gusto-pos-desktop/data/local.sqlite"
elif [ -f "$ROOT_DIR/data/local.sqlite" ]; then
  cp "$ROOT_DIR/data/local.sqlite" "$DIST_DIR/gusto-pos-desktop/data/local.sqlite"
fi

# 5. Create Standalone POS Package runner
echo "📄 Step 4: Writing launcher scripts for POS Desktop..."

# Copy backend dist
mkdir -p "$DIST_DIR/gusto-pos-desktop/server"
cp -R "$ROOT_DIR/apps/pos-local-server/dist" "$DIST_DIR/gusto-pos-desktop/server/"
cp -R "$ROOT_DIR/packages/db-schema" "$DIST_DIR/gusto-pos-desktop/server/" 2>/dev/null || true

# Copy package.json & node_modules minimal runner
cat << 'EOF' > "$DIST_DIR/gusto-pos-desktop/start-pos.sh"
#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "=========================================="
echo "🍽️ Starting Gusto POS & KDS Local Server..."
echo "=========================================="
echo "POS Cashier Screen: http://localhost:8080"
echo "Kitchen KDS Screen: http://localhost:8080/kds"
echo "Captain App Hub:    http://$(ipconfig getifaddr en0 2>/dev/null || echo "YOUR_LOCAL_IP"):8080"
echo "=========================================="

# Open browser after 2 seconds
(sleep 2 && open "http://localhost:8080" 2>/dev/null || true) &

# Run from root repo context with node
export POS_LOCAL_PORT=8080
export POS_LOCAL_DB_PATH="./data/local.sqlite"
node server/dist/index.js
EOF
chmod +x "$DIST_DIR/gusto-pos-desktop/start-pos.sh"

cat << 'EOF' > "$DIST_DIR/gusto-pos-desktop/start-pos.bat"
@echo off
title Gusto POS Local Server
cd /d "%~dp0"
echo ==========================================
echo 🍽️ Starting Gusto POS & KDS Local Server...
echo ==========================================
echo POS Cashier Screen: http://localhost:8080
echo Kitchen KDS Screen: http://localhost:8080/kds
echo ==========================================
start http://localhost:8080
set POS_LOCAL_PORT=8080
set POS_LOCAL_DB_PATH=./data/local.sqlite
node server/dist/index.js
pause
EOF

# 6. Create Quickstart Guides
cat << 'EOF' > "$DIST_DIR/gusto-pos-desktop/CLIENT_TESTING_GUIDE.md"
# Gusto POS & KDS — Client Dry Run Testing Guide

Welcome to the Gusto POS testing bundle! This self-contained package runs the Point of Sale and Kitchen Display System locally on your machine.

---

## 🚀 Quick Start (Under 1 Minute)

### On Windows:
1. Double-click `start-pos.bat`.
2. Your default web browser will automatically open: **http://localhost:8080**

### On macOS / Linux:
1. Open Terminal in this folder and run:
   ```bash
   ./start-pos.sh
   ```
2. Your browser will open **http://localhost:8080**

---

## 🔑 Test Staff PINs

When prompted on the POS login screen:
- **Cashier / Billing:** `1234` (Rahul Kumar)
- **Manager / Admin:** `1234` (Priya Sharma)
- **Owner Access:** `1234` (Dave Bijal)
- **Waiter / Captain:** `5678` (Vikram Singh)

---

## 📱 Testing Key Features

### 1. Point of Sale (POS) Billing (`http://localhost:8080`):
- **Tables & Zones:** Select tables across Main Hall, AC Room, Terrace, or Garden.
- **Search & Filter:** Filter by Veg / Non-Veg / Starters / Beverages / Mains.
- **Add to Cart:** Tap items to add, customize quantity, apply discounts.
- **Send KOT:** Click **"Fire KOT"** to send items to the kitchen immediately.
- **Settle Bill:** Click **"Settle / Pay"**, choose Cash, Card, or UPI, and generate the invoice.

### 2. Kitchen Display Screen (KDS) (`http://localhost:8080/kds`):
- Open **http://localhost:8080/kds** on another browser window, 2nd monitor, or tablet.
- Whenever an order or KOT is fired from POS or Captain App, it appears instantly with sound notification and timer!
- Tap **"In Progress"** when cooking starts, and **"Ready"** (Bump) when the dish is ready for pickup.

### 3. Connecting Mobile Captain App:
- If Captain app is on a phone connected to the same Wi-Fi router:
  - Find your computer's local IP address (e.g., `192.168.1.50`).
  - In Captain App connection screen, enter: `192.168.1.50:8080`.
  - Orders taken on the phone will update this POS and the KDS in real time!
EOF

# 7. Create Captain App Package Guides & Scripts
cat << 'EOF' > "$DIST_DIR/gusto-captain/CAPTAIN_CLIENT_GUIDE.md"
# Gusto Captain — Mobile Waiter Ordering App

The Gusto Captain App is designed for waitstaff and floor captains to take table orders, view live table statuses, add item modifiers, and fire KOTs directly to the kitchen.

---

## ⚡ Option 1: Instant Zero-Install Testing (iOS & Android via Expo Go)

You can test the app on any iPhone or Android phone in 30 seconds without installing an APK:

1. Download the free **Expo Go** app from:
   - **Android:** Google Play Store (Search "Expo Go")
   - **iPhone:** Apple App Store (Search "Expo Go")
2. Make sure the phone is on the same Wi-Fi as your development machine (or use tunnel mode).
3. On your computer, run:
   ```bash
   ./start-expo-go.sh
   ```
4. Scan the displayed QR code with your phone camera (iOS) or inside Expo Go (Android).
5. The Gusto Captain App will launch with full native performance and touch animations!

---

## 📦 Option 2: Standalone Android APK (.apk file)

To generate an installable `.apk` file that can be distributed directly to the client:

1. Run the build script:
   ```bash
   ./build-apk.sh
   ```
2. The build runs on Expo Cloud and provides a direct `.apk` download URL (e.g. `https://expo.dev/artifacts/eas/...`).
3. Send this link to the client; they can download and install it on any Android phone.

---

## 🔑 Login & Connection

1. **Server IP:** Enter the POS Server IP (e.g. `192.168.1.50:8080` or Railway cloud domain).
2. **Staff PIN:** `5678` (Vikram Singh) or `1234`.
3. Select an available table, add food items, tap **"Fire KOT"**, and watch it pop up on the KDS screen instantly!
EOF

cat << 'EOF' > "$DIST_DIR/gusto-captain/start-expo-go.sh"
#!/usr/bin/env bash
cd "$(dirname "$0")/../../apps/app-captain"
echo "=========================================="
echo "📱 Starting Gusto Captain in Expo Go mode..."
echo "=========================================="
echo "1. Open Expo Go on your mobile phone"
echo "2. Scan the QR code below"
echo "=========================================="
npx expo start --go
EOF
chmod +x "$DIST_DIR/gusto-captain/start-expo-go.sh"

cat << 'EOF' > "$DIST_DIR/gusto-captain/build-apk.sh"
#!/usr/bin/env bash
cd "$(dirname "$0")/../../apps/app-captain"
echo "=========================================="
echo "🔨 Building Standalone Android APK..."
echo "=========================================="
echo "Note: If not logged into Expo, you will be prompted to login (free account)."
echo "=========================================="
npx eas-cli build -p android --profile preview
EOF
chmod +x "$DIST_DIR/gusto-captain/build-apk.sh"

# 8. Create KDS Setup Guide
cat << 'EOF' > "$DIST_DIR/gusto-kds/KDS_SETUP_GUIDE.md"
# Gusto KDS (Kitchen Display System) — Client Setup Guide

The Gusto KDS displays incoming food orders in real-time for kitchen chefs, with color-coded preparation timers, order bump buttons, and recall history.

---

## 📺 Option 1: On Any Smart TV / Android TV / Tablet (Recommended)

No installation required!
1. Ensure the Smart TV or Tablet is connected to the restaurant Wi-Fi.
2. Open the built-in browser (Chrome, Silk, or Firefox) on the Smart TV or tablet.
3. Navigate to:
   ```
   http://<POS_SERVER_IP>:8080/kds
   ```
   *(Example: `http://192.168.1.50:8080/kds` or your Railway Cloud URL)*
4. Press **F11** on keyboard or tap **Full Screen** on TV.
5. Done! The screen will stay awake, ping the server, and chime whenever a new KOT arrives.

---

## 📦 Option 2: Standalone Local Runner

1. Open Terminal in `dist-packages/gusto-kds/web`.
2. Run any static server (or double-click `start-kds.sh`):
   ```bash
   npx serve . -p 3002
   ```
3. Open `http://localhost:3002?server=http://<POS_SERVER_IP>:8080` in browser.

---

## 📱 Option 3: Android TV APK (.apk file)

1. Open `apps/kds-tv/android` in Android Studio.
2. Select **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
3. Transfer the generated `app-debug.apk` to the Android TV using a USB stick or "Send Files to TV" app.
EOF

# 9. Create Zip Archive for POS Desktop
echo "🗜️ Step 5: Creating distributable zip archive for POS Desktop..."
cd "$DIST_DIR"
zip -r "gusto-pos-desktop.zip" "gusto-pos-desktop" -q

echo ""
echo "=========================================="
echo "✅ All Client Packages Created Successfully!"
echo "=========================================="
echo "Outputs:"
echo "1. POS Desktop:  $DIST_DIR/gusto-pos-desktop/ (and gusto-pos-desktop.zip)"
echo "2. KDS TV:       $DIST_DIR/gusto-kds/"
echo "3. Captain App:  $DIST_DIR/gusto-captain/"
echo "=========================================="
