#!/bin/bash
# deploy.sh - EVM Market Indexer Deployment Script

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================="
echo "  EVM Market Indexer Deployment Script"
echo "======================================="

# Check if running as service or directly
IS_SERVICE=false
if systemctl is-active --quiet evm-market-indexer; then
  IS_SERVICE=true
  echo "✓ Running as systemd service"
else
  echo "ℹ️ Not running as systemd service"
fi

# Backup database if it exists
DB_PATH=$(grep DB_FILE_PATH .env 2>/dev/null | cut -d '=' -f2 || echo "market_data.sqlite3")
if [ -f "$DB_PATH" ]; then
  echo "📦 Backing up existing database..."
  BACKUP_DIR="./backups"
  mkdir -p "$BACKUP_DIR"
  TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
  BACKUP_FILE="$BACKUP_DIR/market_data_$TIMESTAMP.sqlite3"
  cp "$DB_PATH" "$BACKUP_FILE"
  
  # Also backup the WAL file if it exists
  if [ -f "$DB_PATH-wal" ]; then
    cp "$DB_PATH-wal" "$BACKUP_FILE-wal"
  fi
  
  echo "✓ Database backed up to $BACKUP_FILE"
  
  # Limit number of backups to keep
  MAX_BACKUPS=10
  NUM_BACKUPS=$(ls -1 "$BACKUP_DIR"/market_data_*.sqlite3 | wc -l)
  if [ "$NUM_BACKUPS" -gt "$MAX_BACKUPS" ]; then
    echo "🧹 Cleaning up old backups..."
    ls -1t "$BACKUP_DIR"/market_data_*.sqlite3 | tail -n +$((MAX_BACKUPS+1)) | xargs rm -f
  fi
fi

# Pull latest changes if using git
if [ -d .git ]; then
  echo "🔄 Updating from git repository..."
  git pull origin main
  echo "✓ Code updated"
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "✓ Dependencies installed"

# Check for .env file
if [ ! -f .env ]; then
  echo "⚠️ No .env file found. Creating from template..."
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "⚠️ Please edit .env with your configuration values"
    exit 1
  else
    echo "❌ ERROR: No .env.example found to create .env from"
    exit 1
  fi
fi

# If running as a service, stop/restart
if [ "$IS_SERVICE" = true ]; then
  echo "🔄 Restarting systemd service..."
  sudo systemctl restart evm-market-indexer
  echo "✓ Service restarted"
  
  # Check status
  sleep 2
  if systemctl is-active --quiet evm-market-indexer; then
    echo "✓ Service is active"
  else
    echo "❌ WARNING: Service failed to start properly"
    echo "Check logs with: sudo journalctl -u evm-market-indexer -n 50"
  fi
else
  # Setup systemd service if not already set up
  if [ -f evm-market-indexer.service ] && [ -d /etc/systemd/system ]; then
    echo "🔧 Setting up systemd service..."
    # Copy service file with proper path
    sed "s|WorkingDirectory=.*|WorkingDirectory=$(pwd)|" evm-market-indexer.service > /tmp/evm-market-indexer.service
    sudo mv /tmp/evm-market-indexer.service /etc/systemd/system/evm-market-indexer.service
    sudo systemctl daemon-reload
    sudo systemctl enable evm-market-indexer
    sudo systemctl start evm-market-indexer
    echo "✓ Service installed and started"
  else
    echo "ℹ️ To run directly: npm start"
    echo "ℹ️ For development mode: npm run dev"
  fi
fi

echo "======================================="
echo "✅ Deployment completed successfully"
echo "======================================="