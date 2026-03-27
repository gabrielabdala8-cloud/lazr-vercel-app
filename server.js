const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '100mb' }));

// Serve the dashboard HTML
app.get('/', (req, res) => {
  res.send(getDashboardHTML());
});

// API endpoint for CSV upload
// API endpoint for CSV data auto-load
app.get('/api/csv-data', async (req, res) => {
  try {
    const zlib = require('zlib');
    const filePath = path.join(__dirname, 'data.csv.gz');
    
    if (!fs.existsSync(filePath)) {
      console.log('[CSV] data.csv.gz not found');
      return res.json({ success: false, error: 'No data file' });
    }
    
    const fileBuffer = fs.readFileSync(filePath);
    const decompressed = zlib.gunzipSync(fileBuffer).toString('utf8');
    
    console.log('[CSV] Auto-loading data.csv.gz');
    res.json({ 
      success: true, 
      data: decompressed,
      filename: 'data.csv.gz'
    });
  } catch (err) {
    console.error('[CSV] Error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/upload', (req, res) => {
  const { filename, stats, totalRows } = req.body;
  console.log(`[Upload] ${filename} - ${stats.length} customers, ${totalRows} rows`);
  res.json({ success: true });
});

// API endpoint for AI chat
app.post('/api/chat', async (req, res) => {
  const { message, context } = req.body;

  try {
    const response = await fetch('https://forge.manus.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.VITE_FRONTEND_FORGE_API_KEY || 'sk-test'}`
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: context },
          { role: 'user', content: message }
        ]
      })
    });

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || 'Unable to generate response';
    res.json({ answer });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Chat failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

function getDashboardHTML() {
  try {
    return fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  } catch (err) {
    console.error('Error reading index.html:', err);
    return '<h1>Error loading dashboard</h1>';
  }
}
