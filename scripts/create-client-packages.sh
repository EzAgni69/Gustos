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
if command -v sqlite3 &> /dev/null && [ -f "$ROOT_DIR/apps/pos-local-server/data/local.sqlite" ]; then
  sqlite3 "$ROOT_DIR/apps/pos-local-server/data/local.sqlite" "PRAGMA wal_checkpoint(TRUNCATE);" 2>/dev/null || true
fi
if [ -f "$ROOT_DIR/apps/pos-local-server/data/local.sqlite" ]; then
  cp "$ROOT_DIR/apps/pos-local-server/data/local.sqlite" "$DIST_DIR/gusto-pos-desktop/data/local.sqlite"
elif [ -f "$ROOT_DIR/data/local.sqlite" ]; then
  cp "$ROOT_DIR/data/local.sqlite" "$DIST_DIR/gusto-pos-desktop/data/local.sqlite"
fi
chmod 666 "$DIST_DIR/gusto-pos-desktop/data/local.sqlite" 2>/dev/null || true

# 5. Create Standalone POS Package runner
echo "📄 Step 4: Writing launcher scripts & packaging all dependencies for POS Desktop..."

# Copy backend dist
mkdir -p "$DIST_DIR/gusto-pos-desktop/server"
cp -R "$ROOT_DIR/apps/pos-local-server/dist" "$DIST_DIR/gusto-pos-desktop/server/"

# Copy all core packages into packages/ and server/ so every diagnostic check passes
mkdir -p "$DIST_DIR/gusto-pos-desktop/packages"
cp -R "$ROOT_DIR/packages/core-logic" "$DIST_DIR/gusto-pos-desktop/packages/"
cp -R "$ROOT_DIR/packages/printer" "$DIST_DIR/gusto-pos-desktop/packages/"
cp -R "$ROOT_DIR/packages/db-schema" "$DIST_DIR/gusto-pos-desktop/packages/"
cp -R "$ROOT_DIR/packages/api-contracts" "$DIST_DIR/gusto-pos-desktop/packages/"

# Also copy into server/ for direct relative imports
cp -R "$ROOT_DIR/packages/core-logic" "$DIST_DIR/gusto-pos-desktop/server/"
cp -R "$ROOT_DIR/packages/printer" "$DIST_DIR/gusto-pos-desktop/server/"
cp -R "$ROOT_DIR/packages/db-schema" "$DIST_DIR/gusto-pos-desktop/server/"
cp -R "$ROOT_DIR/packages/api-contracts" "$DIST_DIR/gusto-pos-desktop/server/"

# Populate node_modules/@gusto so local resolution always succeeds
mkdir -p "$DIST_DIR/gusto-pos-desktop/node_modules/@gusto"
cp -R "$ROOT_DIR/packages/core-logic" "$DIST_DIR/gusto-pos-desktop/node_modules/@gusto/"
cp -R "$ROOT_DIR/packages/printer" "$DIST_DIR/gusto-pos-desktop/node_modules/@gusto/"
cp -R "$ROOT_DIR/packages/db-schema" "$DIST_DIR/gusto-pos-desktop/node_modules/@gusto/"
cp -R "$ROOT_DIR/packages/api-contracts" "$DIST_DIR/gusto-pos-desktop/node_modules/@gusto/"

# Also copy local pre-compiled better-sqlite3 and its native bindings dependencies for immediate execution
if [ -d "$ROOT_DIR/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3" ]; then
  cp -RL "$ROOT_DIR/node_modules/.pnpm/better-sqlite3@11.10.0/node_modules/better-sqlite3" "$DIST_DIR/gusto-pos-desktop/node_modules/" 2>/dev/null || true
  cp -RL "$ROOT_DIR/node_modules/.pnpm/bindings@1.5.0/node_modules/bindings" "$DIST_DIR/gusto-pos-desktop/node_modules/" 2>/dev/null || true
  cp -RL "$ROOT_DIR/node_modules/.pnpm/file-uri-to-path@1.0.0/node_modules/file-uri-to-path" "$DIST_DIR/gusto-pos-desktop/node_modules/" 2>/dev/null || true
  touch "$DIST_DIR/gusto-pos-desktop/node_modules/.unix_installed" 2>/dev/null || true
fi

# Clean private workspace devDependencies from copied packages so npm install never 404s
find "$DIST_DIR/gusto-pos-desktop" -name "package.json" | while read -r pkg_json; do
  node -e '
    const fs = require("fs");
    const file = process.argv[1];
    try {
      const json = JSON.parse(fs.readFileSync(file, "utf8"));
      if (json.devDependencies) {
        delete json.devDependencies["@gusto/eslint-config"];
        delete json.devDependencies["@gusto/tsconfig"];
      }
      fs.writeFileSync(file, JSON.stringify(json, null, 2));
    } catch (_err) {
      // ignore
    }
  ' "$pkg_json"
done

# Create clean Root package.json
cat << 'EOF' > "$DIST_DIR/gusto-pos-desktop/package.json"
{
  "name": "gusto-pos-desktop",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Gusto POS Desktop & Local Server (Self-Contained Client Release)",
  "main": "server/dist/index.js",
  "scripts": {
    "start": "node server/dist/index.js",
    "install-deps": "npm install --no-audit --no-fund"
  },
  "dependencies": {
    "better-sqlite3": "^11.10.0"
  }
}
EOF

# Copy root package.json to server/ as well
cp "$DIST_DIR/gusto-pos-desktop/package.json" "$DIST_DIR/gusto-pos-desktop/server/package.json"

# Self-healing launcher scripts
cat << 'EOF' > "$DIST_DIR/gusto-pos-desktop/start-pos.sh"
#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "=========================================="
echo "🍽️ Starting Gusto POS & KDS Local Server..."
echo "=========================================="

# Check if node is installed
if ! command -v node &> /dev/null; then
  echo "❌ [ERROR] Node.js is not found. Please install Node.js (v20+ LTS) from https://nodejs.org/"
  exit 1
fi

# Auto-install runtime database module if missing or binary incompatible
if ! node -e 'require("better-sqlite3")' 2>/dev/null; then
  echo "📦 Installing required database engine (better-sqlite3)..."
  npm install --no-audit --no-fund
  touch "node_modules/.unix_installed" 2>/dev/null || true
fi

echo "POS Cashier Screen: http://localhost:8080"
echo "Kitchen KDS Screen: http://localhost:8080/kds"
echo "Captain App Hub:    http://$(ipconfig getifaddr en0 2>/dev/null || echo "YOUR_LOCAL_IP"):8080"
echo "=========================================="

# Open browser after 2 seconds
(sleep 2 && (open "http://localhost:8080" 2>/dev/null || xdg-open "http://localhost:8080" 2>/dev/null || true)) &

# Run server
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

REM Check if node is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js was not detected!
  echo Please download and install Node.js (v20 LTS or higher) from:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)

REM Auto-install runtime database module for Windows if missing or incompatible
node -e "require('better-sqlite3')" >nul 2>nul
if %errorlevel% neq 0 (
  echo [1/2] Installing required database engine for Windows (better-sqlite3)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install encountered an issue. Check your internet connection.
    pause
    exit /b 1
  )
  type nul > "node_modules\.windows_installed"
)

echo [2/2] Launching Gusto POS & KDS Services...
echo POS Cashier Screen: http://localhost:8080
echo Kitchen KDS Screen: http://localhost:8080/kds
echo ==========================================
start http://localhost:8080
set POS_LOCAL_PORT=8080
set POS_LOCAL_DB_PATH=./data/local.sqlite
node server/dist/index.js
if errorlevel 1 (
  echo.
  echo [ERROR] POS Server stopped with an error.
  pause
)
EOF

# Copy comprehensive client handover guide if available
if [ -f "$ROOT_DIR/docs/CLIENT_HANDOVER_AND_RUN_GUIDE.md" ]; then
  cp "$ROOT_DIR/docs/CLIENT_HANDOVER_AND_RUN_GUIDE.md" "$DIST_DIR/gusto-pos-desktop/CLIENT_HANDOVER_AND_RUN_GUIDE.md"
  cp "$ROOT_DIR/docs/CLIENT_HANDOVER_AND_RUN_GUIDE.md" "$DIST_DIR/CLIENT_HANDOVER_AND_RUN_GUIDE.md"
fi

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

# Copy Captain App source and configuration for standalone operation
mkdir -p "$DIST_DIR/gusto-captain/app"
mkdir -p "$DIST_DIR/gusto-captain/src"
mkdir -p "$DIST_DIR/gusto-captain/assets"

cp -R "$ROOT_DIR/apps/app-captain/app/"* "$DIST_DIR/gusto-captain/app/"
cp -R "$ROOT_DIR/apps/app-captain/src/"* "$DIST_DIR/gusto-captain/src/"
cp -R "$ROOT_DIR/apps/app-captain/assets/"* "$DIST_DIR/gusto-captain/assets/" 2>/dev/null || true
cp "$ROOT_DIR/apps/app-captain/app.json" "$DIST_DIR/gusto-captain/app.json"
cp "$ROOT_DIR/apps/app-captain/babel.config.js" "$DIST_DIR/gusto-captain/babel.config.js"
cp "$ROOT_DIR/apps/app-captain/eas.json" "$DIST_DIR/gusto-captain/eas.json" 2>/dev/null || true

# Standalone tsconfig
cat << 'EOF' > "$DIST_DIR/gusto-captain/tsconfig.json"
{
  "compilerOptions": {
    "strict": true,
    "jsx": "react-native",
    "moduleResolution": "bundler",
    "paths": {
      "@/*": [
        "./src/*"
      ]
    }
  },
  "include": [
    "**/*.ts",
    "**/*.tsx"
  ],
  "exclude": [
    "node_modules"
  ]
}
EOF

# Standalone metro.config.js
cat << 'EOF' > "$DIST_DIR/gusto-captain/metro.config.js"
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = false;
module.exports = config;
EOF

# Clean standalone package.json
node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (pkg.dependencies) {
    delete pkg.dependencies["@gusto/api-contracts"];
    delete pkg.dependencies["@gusto/core-logic"];
  }
  if (pkg.devDependencies) {
    delete pkg.devDependencies["@gusto/tsconfig"];
  }
  pkg.name = "gusto-captain";
  fs.writeFileSync(process.argv[2], JSON.stringify(pkg, null, 2));
' "$ROOT_DIR/apps/app-captain/package.json" "$DIST_DIR/gusto-captain/package.json"

cat << 'EOF' > "$DIST_DIR/gusto-captain/start-expo-go.sh"
#!/usr/bin/env bash
if [ -d "$(dirname "$0")/../../apps/app-captain" ]; then
  cd "$(dirname "$0")/../../apps/app-captain"
else
  cd "$(dirname "$0")"
fi
echo "=========================================="
echo "📱 Starting Gusto Captain in Expo Go mode..."
echo "=========================================="
if [ ! -d "node_modules" ]; then
  echo "📦 Installing required dependencies for Captain App..."
  npm install --no-audit --no-fund
fi
echo "1. Open Expo Go on your mobile phone"
echo "2. Scan the QR code below"
echo "=========================================="
npx expo start --go
EOF
chmod +x "$DIST_DIR/gusto-captain/start-expo-go.sh"

cat << 'EOF' > "$DIST_DIR/gusto-captain/start-expo-go.bat"
@echo off
title Gusto Captain Waiter App
if exist "%~dp0..\..\apps\app-captain" (
  cd /d "%~dp0..\..\apps\app-captain"
) else (
  cd /d "%~dp0"
)
echo ==========================================
echo 📱 Starting Gusto Captain in Expo Go mode...
echo ==========================================
if not exist "node_modules" (
  echo [1/2] Installing required dependencies for Captain App...
  call npm install --no-audit --no-fund
)
echo [2/2] Launching Expo Go...
echo 1. Open Expo Go on your mobile phone
echo 2. Scan the QR code below
echo ==========================================
call npx expo start --go
if errorlevel 1 (
  echo.
  echo [ERROR] Expo process stopped.
  pause
)
EOF

cat << 'EOF' > "$DIST_DIR/gusto-captain/build-apk.sh"
#!/usr/bin/env bash
if [ -d "$(dirname "$0")/../../apps/app-captain" ]; then
  cd "$(dirname "$0")/../../apps/app-captain"
else
  cd "$(dirname "$0")"
fi
echo "=========================================="
echo "🔨 Building Standalone Android APK..."
echo "=========================================="
echo "Note: If not logged into Expo, you will be prompted to login (free account)."
echo "=========================================="
npx eas-cli build -p android --profile preview
EOF
chmod +x "$DIST_DIR/gusto-captain/build-apk.sh"

cat << 'EOF' > "$DIST_DIR/gusto-captain/build-apk.bat"
@echo off
title Build Standalone Android APK
if exist "%~dp0..\..\apps\app-captain" (
  cd /d "%~dp0..\..\apps\app-captain"
) else (
  cd /d "%~dp0"
)
echo ==========================================
echo 🔨 Building Standalone Android APK...
echo ==========================================
call npx eas-cli build -p android --profile preview
pause
EOF

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

cat << 'EOF' > "$DIST_DIR/gusto-kds/start-kds.sh"
#!/usr/bin/env bash
cd "$(dirname "$0")/web"
echo "=========================================="
echo "📺 Starting Gusto KDS Kitchen Display..."
echo "=========================================="
PORT=${KDS_PORT:-3002}
echo "KDS Web URL: http://localhost:$PORT"
(sleep 2 && (open "http://localhost:$PORT" 2>/dev/null || xdg-open "http://localhost:$PORT" 2>/dev/null || true)) &
npx -y serve . -p "$PORT"
EOF
chmod +x "$DIST_DIR/gusto-kds/start-kds.sh"

cat << 'EOF' > "$DIST_DIR/gusto-kds/start-kds.bat"
@echo off
title Gusto KDS Kitchen Display
cd /d "%~dp0\web"
echo ==========================================
echo 📺 Starting Gusto KDS Kitchen Display...
echo ==========================================
start http://localhost:3002
call npx -y serve . -p 3002
EOF

# 9. Create Zip Archives
echo "🗜️ Step 5: Creating distributable zip archives..."
cd "$DIST_DIR"
zip -r "gusto-pos-desktop.zip" "gusto-pos-desktop" -q
zip -r "gusto-kds.zip" "gusto-kds" -q
zip -r "gusto-captain.zip" "gusto-captain" -q

echo ""
echo "=========================================="
echo "✅ All Client Packages Created Successfully!"
echo "=========================================="
echo "Outputs:"
echo "1. POS Desktop:  $DIST_DIR/gusto-pos-desktop.zip"
echo "2. KDS TV:       $DIST_DIR/gusto-kds.zip"
echo "3. Captain App:  $DIST_DIR/gusto-captain.zip"
echo "=========================================="
