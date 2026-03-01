const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Serve the dashboard HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint for CSV upload (just acknowledge, data is processed client-side)
app.post('/api/upload', (req, res) => {
  const { filename, stats, totalRows } = req.body;
  console.log(`[Upload] ${filename} - ${stats?.length || 0} customers, ${totalRows} rows`);
  res.json({ success: true, message: 'CSV data received' });
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
