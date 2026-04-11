#!/bin/bash

# AI Teaching Assistant Platform - Startup Script (Cross-platform)

echo "🚀 AI Teaching Assistant Platform - Starting..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install dependencies"
        exit 1
    fi
fi

echo "✅ Dependencies ready!"
echo ""
echo "🌐 Starting development server..."
echo "📍 The application will open at: http://localhost:3000"
echo ""
echo "📝 Instructions:"
echo "   1. Configure your API key in the LLM Settings"
echo "   2. Upload course materials (PDF, DOCX, XLSX, etc.)"
echo "   3. Select a module (Drills, Labs, Homework, or Exams)"
echo "   4. Generate educational content!"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start the development server
npm run dev
