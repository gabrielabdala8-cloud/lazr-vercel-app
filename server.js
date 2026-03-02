const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage for CSV data
let csvData = null;
let csvFilename = null;

// Load CSV from data folder on startup (supports both .csv and .csv.gz)
function loadCSVFromFile() {
  try {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log('[Startup] Created data folder');
      return;
    }
    
    // Look for .csv.gz first (compressed), then .csv
    let files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv.gz'));
    let isCompressed = true;
    
    if (files.length === 0) {
      files = fs.readdirSync(dataDir).filter(f => f.endsWith('.csv'));
      isCompressed = false;
    }
    
    if (files.length > 0) {
      const csvFile = files[0];
      const csvPath = path.join(dataDir, csvFile);
      
      if (isCompressed) {
        // Decompress gzip file
        const compressed = fs.readFileSync(csvPath);
        csvData = zlib.gunzipSync(compressed).toString('utf-8');
        csvFilename = csvFile.replace('.gz', '');
        console.log(`[Startup] Loaded and decompressed CSV from data/${csvFile}`);
      } else {
        // Read plain CSV
        csvData = fs.readFileSync(csvPath, 'utf-8');
        csvFilename = csvFile;
        console.log(`[Startup] Loaded CSV from data/${csvFile}`);
      }
    } else {
      console.log('[Startup] No CSV files found in data folder');
    }
  } catch (err) {
    console.error('[Startup] Error loading CSV:', err.message);
  }
}

// Load CSV on server start
loadCSVFromFile();

// Serve the dashboard HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get stored CSV data
app.get('/api/csv-data', (req, res) => {
  if (csvData) {
    res.json({ success: true, data: csvData, filename: csvFilename });
  } else {
    res.json({ success: false, message: 'No CSV data stored' });
  }
});

// API endpoint for CSV upload - store in memory (for local testing)
app.post('/api/upload', (req, res) => {
  const { filename, csvContent } = req.body;
  
  if (!csvContent) {
    return res.status(400).json({ success: false, message: 'No CSV content provided' });
  }
  
  try {
    csvData = csvContent;
    csvFilename = filename;
    console.log(`[Upload] ${filename} stored in memory`);
    res.json({ success: true, message: 'CSV data stored successfully' });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, message: 'Upload failed' });
  }
});

// Smart local AI analyzer - extracts real data from context
function analyzeDiscrepancies(message, context) {
  const lower = message.toLowerCase();
  
  // Parse the context to extract key metrics
  const parseNumber = (text, pattern) => {
    const match = text.match(pattern);
    return match ? match[1].replace(/,/g, '') : null;
  };
  
  const totalOrders = parseNumber(context, /(\d+(?:,\d+)*) orders/);
  const totalQuoted = parseNumber(context, /Total Quoted: \$([0-9,.]+)/);
  const totalBilled = parseNumber(context, /Total Billed: \$([0-9,.]+)/);
  const netDisc = parseNumber(context, /Net Discrepancy: [+-]\$([0-9,.]+)/);
  const overchargedCount = parseNumber(context, /Overcharged orders: (\d+(?:,\d+)*)/);
  const underchargedCount = parseNumber(context, /Undercharged orders: (\d+(?:,\d+)*)/);
  
  // Extract top customers
  const customerMatches = context.match(/TOP CUSTOMERS BY DISCREPANCY:([\s\S]*?)(?=BY TRANSPORT|$)/);
  const topCustomers = customerMatches ? customerMatches[1].split('\n').filter(l => l.includes('-')).slice(0, 3) : [];
  
  // Extract carriers
  const carrierMatches = context.match(/BY CARRIER:([\s\S]*?)(?=TOP LANES|$)/);
  const carriers = carrierMatches ? carrierMatches[1].split('\n').filter(l => l.includes('-')).slice(0, 5) : [];
  
  // Extract lanes
  const laneMatches = context.match(/TOP LANES BY DISCREPANCY:([\s\S]*?)(?=BY ORIGIN|$)/);
  const topLanes = laneMatches ? laneMatches[1].split('\n').filter(l => l.includes('-')).slice(0, 3) : [];
  
  // Answer specific questions with real data
  if (lower.includes('highest') && (lower.includes('customer') || lower.includes('org'))) {
    if (topCustomers.length > 0) {
      return 'Top customers by discrepancy:\n' + topCustomers.map(c => c.trim()).join('\n');
    }
  }
  
  if (lower.includes('carrier')) {
    if (carriers.length > 0) {
      return 'Carrier discrepancy analysis:\n' + carriers.map(c => c.trim()).join('\n');
    }
  }
  
  if (lower.includes('lane') || lower.includes('route')) {
    if (topLanes.length > 0) {
      return 'Top lanes by discrepancy:\n' + topLanes.map(l => l.trim()).join('\n');
    }
  }
  
  if (lower.includes('summary') || lower.includes('overview') || lower.includes('total')) {
    let summary = 'DISCREPANCY SUMMARY:\n';
    if (totalOrders) summary += `• Total Orders: ${totalOrders}\n`;
    if (totalQuoted) summary += `• Total Quoted: $${totalQuoted}\n`;
    if (totalBilled) summary += `• Total Billed: $${totalBilled}\n`;
    if (netDisc) summary += `• Net Discrepancy: $${netDisc}\n`;
    if (overchargedCount) summary += `• Overcharged Orders: ${overchargedCount}\n`;
    if (underchargedCount) summary += `• Undercharged Orders: ${underchargedCount}\n`;
    return summary;
  }
  
  if (lower.includes('overcharge')) {
    if (overchargedCount) {
      return `You have ${overchargedCount} overcharged orders where customers were billed MORE than quoted. This represents revenue leakage. Check the red-highlighted rows in the dashboard to identify patterns.`;
    }
  }
  
  if (lower.includes('undercharge')) {
    if (underchargedCount) {
      return `You have ${underchargedCount} undercharged orders where customers were billed LESS than quoted. These are shown in yellow. Review your pricing strategy for these routes and carriers.`;
    }
  }
  
  if (lower.includes('help') || lower.includes('what can')) {
    return 'I can analyze your LAZR discrepancy data. Try asking:\n• "What is the summary?"\n• "Which customer has the highest overcharge?"\n• "Show me carrier analysis"\n• "What are the top lanes?"\n• "How many overcharged orders?"';
  }
  
  // Default - show summary
  let defaultResponse = 'DISCREPANCY ANALYSIS:\n';
  if (totalOrders) defaultResponse += `• Total Orders: ${totalOrders}\n`;
  if (overchargedCount) defaultResponse += `• Overcharged: ${overchargedCount}\n`;
  if (underchargedCount) defaultResponse += `• Undercharged: ${underchargedCount}\n`;
  if (topCustomers.length > 0) defaultResponse += `\nTop Customer: ${topCustomers[0]}\n`;
  return defaultResponse;
}

// API endpoint for AI chat
app.post('/api/chat', async (req, res) => {
  const { message, context } = req.body;

  try {
    // Use local analyzer with real data extraction
    const answer = analyzeDiscrepancies(message, context);
    res.json({ answer });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Chat failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
