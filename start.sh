#!/bin/bash
echo ""
echo "  -----------------------------------------------"
echo "   Church Live Translator"
echo "  -----------------------------------------------"
echo ""

if ! command -v node &> /dev/null; then
  echo "  ERROR: Node.js is not installed."
  echo "  Download it from: https://nodejs.org"
  exit 1
fi

echo "  Installing packages (only needed first time)..."
npm install

echo ""
echo "  Starting server..."
echo ""
node server.js
