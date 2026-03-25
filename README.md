# LAZR Discrepancy Agent - Vercel

Simple Express app with embedded dashboard for analyzing LAZR billing discrepancies.

## Features
- **CSV from GitHub** - Store CSV in `data/` folder, auto-loads on page load
- **Customer Breakdown** - Click customer names to see their orders
- **Discrepancies Filter** - Toggle to show only orders with billing issues
- **AI Chat** - Ask questions about discrepancies
- **Order Search** - Find specific orders by number

## How to Use

### 1. Add Your CSV to GitHub
1. Create a `data/` folder in the repo root (if it doesn't exist)
2. Add your LAZR export CSV file: `data/lazr-data.csv`
3. Commit and push to GitHub
4. Vercel auto-deploys

### 2. Share with Your Boss
- Share the Vercel URL
- The dashboard loads automatically with the latest CSV from GitHub
- No manual upload needed

### 3. Weekly Updates
1. Update the CSV file in `data/` folder on GitHub
2. Push to GitHub
3. Vercel redeploys automatically
4. Your boss refreshes the page to see new data

## File Structure
```
lazr-vercel-app/
├── data/
│   └── lazr-data.csv          ← Put your CSV here
├── public/
│   └── index.html             ← Dashboard
├── server.js                  ← Express server
└── package.json
```

## Deploy
1. Push changes to GitHub
2. Vercel auto-deploys
3. Share the URL with your boss

## Features
- **Show Discrepancies Only** - Filter to see only orders with billing differences
- **Customer Details** - Click any customer to see all their orders
- **AI Analysis** - Ask the AI about your data
