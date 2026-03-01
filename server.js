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

// Simple local AI analyzer - no external API needed
function analyzeDiscrepancies(message, context) {
  const lower = message.toLowerCase();
  
  // Extract data from context
  const orderMatch = context.match(/(\d+(?:,\d+)*) orders/);
  const discMatch = context.match(/Net Discrepancy: ([^\n]+)/);
  const overMatch = context.match(/Overcharged orders: (\d+)/);
  const underMatch = context.match(/Undercharged orders: (\d+)/);
  
  // Simple pattern matching for common questions
  if (lower.includes('highest') || lower.includes('most')) {
    if (lower.includes('customer') || lower.includes('org')) {
      return 'Based on the data, the top customers by discrepancy are listed in the breakdown tables. Check the "Customer" tab to see which customers have the highest overcharges or undercharges.';
    }
    if (lower.includes('carrier')) {
      return 'The carriers with the highest discrepancies are shown in the "Carrier" breakdown. Look for the red-highlighted rows which indicate overcharges.';
    }
    if (lower.includes('transport')) {
      return 'The transport types with the highest discrepancies are displayed in the "Transport Type" tab. Check which service has the most billing issues.';
    }
  }
  
  if (lower.includes('summary') || lower.includes('summarize')) {
    return `Summary: The data shows ${orderMatch ? orderMatch[1] : 'multiple'} orders with a net discrepancy of ${discMatch ? discMatch[1] : 'unknown'}. There are ${overMatch ? overMatch[1] : '?'} overcharged orders and ${underMatch ? underMatch[1] : '?'} undercharged orders. Use the filters and tabs to drill down into specific categories.`;
  }
  
  if (lower.includes('overcharge')) {
    return 'Overcharged orders are shown in red in the discrepancy columns. These are cases where customers were billed MORE than the quoted price. Check the "Show Discrepancies Only" filter to see only these problematic orders.';
  }
  
  if (lower.includes('undercharge')) {
    return 'Undercharged orders are shown in yellow. These are cases where customers were billed LESS than quoted. While not a loss, they represent revenue leakage. Review the pricing strategy for these lanes and carriers.';
  }
  
  if (lower.includes('lane') || lower.includes('route')) {
    return 'The top lanes by discrepancy are shown in the "Lane" tab. Click on any lane to see all orders on that route and identify patterns in billing issues.';
  }
  
  if (lower.includes('carrier')) {
    return 'Review the "Carrier" breakdown to see which carriers have the most discrepancies. This can help identify carriers with billing accuracy issues.';
  }
  
  if (lower.includes('help') || lower.includes('how')) {
    return 'I can help analyze discrepancies in your LAZR data. Try asking: "Which customer has the highest overcharge?", "Summarize discrepancies by carrier", "Show me undercharged orders", or "What are the top lanes by discrepancy?"';
  }
  
  // Default response
  return 'I can analyze your discrepancy data. Try asking about specific customers, carriers, lanes, or transport types. Use the filters and tabs to explore the data in detail.';
}

// API endpoint for AI chat
app.post('/api/chat', async (req, res) => {
  const { message, context } = req.body;

  try {
    // Use local analyzer instead of external API
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
