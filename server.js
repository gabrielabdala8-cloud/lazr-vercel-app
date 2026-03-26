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
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LAZR Discrepancy Agent</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    .hidden { display: none; }
    .tab-active { border-b-2 border-blue-600; color: #1e40af; }
    .tab-inactive { border-b-2 border-transparent; color: #6b7280; }
  </style>
</head>
<body class="bg-gray-50">
  <div id="app"></div>

  <script>
    const state = {
      data: null,
      filtered: [],
      activeTab: 'client',
      selectedMonth: '',
      selectedCustomer: '',
      searchOrder: '',
      showChat: false,
      messages: []
    };

    function parseCSV(text) {
      const lines = text.trim().split('\\n');
      const headers = parseCSVLine(lines[0]);
      
      const orderNumberIdx = headers.findIndex(h => h.toUpperCase().includes('ORDER'));
      const customerIdx = headers.findIndex(h => h.toUpperCase().includes('ORGANIZATION'));
      const dateIdx = headers.findIndex(h => h.toUpperCase().includes('DATE'));
      const transportIdx = headers.findIndex(h => h.toUpperCase().includes('TRANSPORT'));
      const serviceIdx = headers.findIndex(h => h.toUpperCase().includes('SERVICE'));
      const carrierIdx = headers.findIndex(h => h.toUpperCase().includes('CARRIER'));
      const laneIdx = headers.findIndex(h => h.toUpperCase().includes('LANE'));
      
      const sellingIdx = headers.findIndex(h => h.toUpperCase().includes('SELLING PRICE'));
      const billedSellingIdx = headers.findIndex(h => h.toUpperCase().includes('BILLED SELLING'));
      
      const totalCarrierCostIdx = headers.findIndex(h => h.toUpperCase().includes('TOTAL CARRIER COST'));
      const reconciledQuoteIdx = headers.findIndex(h => h.toUpperCase().includes('RECONCILED QUOTE PRICE'));
      const freightAccessorialsIdx = headers.findIndex(h => h.toUpperCase().includes('FREIGHT COST + ACCESSORIALS'));
      const fuelSurchargeIdx = headers.findIndex(h => h.toUpperCase().includes('FUEL SURCHARGE'));

      const orders = [];
      const clientStats = new Map();
      const carrierStats = new Map();
      let minDate = '2099-12-31';
      let maxDate = '1900-01-01';

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = parseCSVLine(line);
        
        const orderNumber = cols[orderNumberIdx]?.trim() || \`ORDER_\${i}\`;
        const customer = cols[customerIdx]?.trim() || 'Unknown';
        const date = cols[dateIdx]?.trim() || '2025-01-01';
        const month = date.substring(0, 7);
        const transportType = cols[transportIdx]?.trim() || 'Unknown';
        const serviceType = cols[serviceIdx]?.trim() || 'Standard';
        const carrier = cols[carrierIdx]?.trim() || 'Unknown';
        const lane = cols[laneIdx]?.trim() || 'N/A';
        
        const sellingPrice = parseFloat(cols[sellingIdx]) || 0;
        const billedSellingPrice = parseFloat(cols[billedSellingIdx]) || 0;
        const clientDiscrepancy = billedSellingPrice - sellingPrice;
        
        const totalCarrierCost = parseFloat(cols[totalCarrierCostIdx]) || 0;
        const reconciledQuote = parseFloat(cols[reconciledQuoteIdx]) || 0;
        const carrierDiscrepancy = reconciledQuote - totalCarrierCost;
        const freightAccessorials = parseFloat(cols[freightAccessorialsIdx]) || 0;
        const fuelSurcharge = parseFloat(cols[fuelSurchargeIdx]) || 0;
        
        const order = {
          orderNumber, customer, date, month, transportType, serviceType,
          carrier, lane,
          sellingPrice, billedSellingPrice, clientDiscrepancy,
          totalCarrierCost, reconciledQuote, carrierDiscrepancy,
          freightAccessorials, fuelSurcharge
        };

        orders.push(order);
        minDate = date < minDate ? date : minDate;
        maxDate = date > maxDate ? date : maxDate;

        if (!clientStats.has(customer)) {
          clientStats.set(customer, {
            customer, orders: 0, totalSelling: 0, totalBilled: 0,
            totalDiscrepancy: 0, overcharges: 0, undercharges: 0, matches: 0
          });
        }
        const clientStat = clientStats.get(customer);
        clientStat.orders++;
        clientStat.totalSelling += sellingPrice;
        clientStat.totalBilled += billedSellingPrice;
        clientStat.totalDiscrepancy += clientDiscrepancy;
        if (Math.abs(clientDiscrepancy) < 0.01) clientStat.matches++;
        else if (clientDiscrepancy > 0) clientStat.overcharges++;
        else clientStat.undercharges++;

        if (!carrierStats.has(carrier)) {
          carrierStats.set(carrier, {
            carrier, orders: 0, totalQuoted: 0, totalBilled: 0,
            totalDiscrepancy: 0, overcharges: 0, undercharges: 0, matches: 0
          });
        }
        const carrierStat = carrierStats.get(carrier);
        carrierStat.orders++;
        carrierStat.totalQuoted += totalCarrierCost;
        carrierStat.totalBilled += reconciledQuote;
        carrierStat.totalDiscrepancy += carrierDiscrepancy;
        if (Math.abs(carrierDiscrepancy) < 0.01) carrierStat.matches++;
        else if (carrierDiscrepancy > 0) carrierStat.overcharges++;
        else carrierStat.undercharges++;
      }

      const clientStatsList = Array.from(clientStats.values())
        .map(s => ({
          ...s,
          totalDiscrepancy: Math.round(s.totalDiscrepancy * 100) / 100,
          discrepancyRate: s.totalSelling > 0 ? (s.totalDiscrepancy / s.totalSelling) * 100 : 0,
          severity: Math.abs(s.totalDiscrepancy) < 50 ? 'green' : Math.abs(s.totalDiscrepancy) < 500 ? 'yellow' : 'red'
        }))
        .sort((a, b) => Math.abs(b.totalDiscrepancy) - Math.abs(a.totalDiscrepancy));

      const carrierStatsList = Array.from(carrierStats.values())
        .map(s => ({
          ...s,
          totalDiscrepancy: Math.round(s.totalDiscrepancy * 100) / 100,
          discrepancyRate: s.totalQuoted > 0 ? (s.totalDiscrepancy / s.totalQuoted) * 100 : 0,
          severity: Math.abs(s.totalDiscrepancy) < 50 ? 'green' : Math.abs(s.totalDiscrepancy) < 500 ? 'yellow' : 'red'
        }))
        .sort((a, b) => Math.abs(b.totalDiscrepancy) - Math.abs(a.totalDiscrepancy));

      return { 
        orders, 
        clientStats: clientStatsList,
        carrierStats: carrierStatsList,
        dateRange: { from: minDate, to: maxDate } 
      };
    }

    function parseCSVLine(line) {
      const result = [];
      let current = '';
      let inQuotes = false;
      
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim().replace(/^"|"$/g, ''));
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim().replace(/^"|"$/g, ''));
      return result;
    }

    function applyFilters() {
      let orders = state.data.orders;

      if (state.selectedMonth) {
        orders = orders.filter(o => o.month === state.selectedMonth);
      }

      if (state.selectedCustomer) {
        orders = orders.filter(o => o.customer === state.selectedCustomer);
      }

      if (state.searchOrder) {
        orders = orders.filter(o =>
          o.orderNumber.toLowerCase().includes(state.searchOrder.toLowerCase())
        );
      }

      state.filtered = orders;
      render();
    }

    async function handleCSVUpload(e) {
      const file = e.target.files[0];
      if (!file) return;

      const text = await file.text();
      state.data = parseCSV(text);
      state.filtered = state.data.orders;

      const statsToSend = state.activeTab === 'client' ? state.data.clientStats : state.data.carrierStats;
      await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          stats: statsToSend,
          totalRows: state.data.orders.length
        })
      });

      render();
    }

    async function sendChatMessage() {
      const input = document.getElementById('chatInput');
      const message = input.value.trim();
      if (!message) return;

      state.messages.push({ role: 'user', content: message });
      input.value = '';
      render();

      const stats = state.activeTab === 'client' ? state.data.clientStats : state.data.carrierStats;
      const totalDisc = stats.reduce((s, c) => s + c.totalDiscrepancy, 0);
      
      const context = state.activeTab === 'client' 
        ? \`You are a logistics billing analyst analyzing CUSTOMER-SIDE discrepancies (Selling Price vs Billed Price).
- Total orders: \${state.filtered.length}
- Total customers: \${state.data.clientStats.length}
- Net discrepancy: \$\${totalDisc.toFixed(2)}
- Overcharges: \${stats.reduce((s, c) => s + c.overcharges, 0)}
- Undercharges: \${stats.reduce((s, c) => s + c.undercharges, 0)}

Top customers by discrepancy:
\${stats.slice(0, 5).map((s) => \`- \${s.customer}: \$\${s.totalDiscrepancy.toFixed(2)} (\${s.orders} orders)\`).join('\\n')}

Answer concisely and professionally.\`
        : \`You are a logistics cost analyst analyzing CARRIER-SIDE discrepancies (Quoted Cost vs Billed Cost).
- Total orders: \${state.filtered.length}
- Total carriers: \${state.data.carrierStats.length}
- Net discrepancy: \$\${totalDisc.toFixed(2)}
- Overcharges: \${stats.reduce((s, c) => s + c.overcharges, 0)}
- Undercharges: \${stats.reduce((s, c) => s + c.undercharges, 0)}

Top carriers by discrepancy:
\${stats.slice(0, 5).map((s) => \`- \${s.carrier}: \$\${s.totalDiscrepancy.toFixed(2)} (\${s.orders} orders)\`).join('\\n')}

Answer concisely and professionally.\`;

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, context })
        });

        const data = await response.json();
        state.messages.push({ role: 'assistant', content: data.answer || 'Error' });
      } catch (err) {
        state.messages.push({ role: 'assistant', content: 'Chat error' });
      }

      render();
    }

    function render() {
      const app = document.getElementById('app');

      if (!state.data) {
        app.innerHTML = \`
          <div class="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
            <div class="w-full max-w-md">
              <div class="border-2 border-dashed border-blue-300 rounded-lg p-12 text-center bg-white shadow-lg">
                <div class="text-4xl mb-4">📊</div>
                <h1 class="text-2xl font-bold text-gray-800 mb-2">LAZR Discrepancy Agent</h1>
                <p class="text-gray-600 mb-6">Upload your LAZR export CSV to analyze discrepancies</p>
                <input type="file" accept=".csv" onchange="handleCSVUpload(event)" class="hidden" id="fileInput">
                <button onclick="document.getElementById('fileInput').click()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg">
                  Select CSV File
                </button>
              </div>
            </div>
          </div>
        \`;
        return;
      }

      const stats = state.activeTab === 'client' ? state.data.clientStats : state.data.carrierStats;
      const totalDisc = stats.reduce((s, c) => s + c.totalDiscrepancy, 0);
      const months = [...new Set(state.data.orders.map(o => o.month))].sort().reverse();
      const customers = state.activeTab === 'client' 
        ? [...new Set(state.data.orders.map(o => o.customer))].sort()
        : [...new Set(state.data.orders.map(o => o.carrier))].sort();

      app.innerHTML = \`
        <div class="min-h-screen bg-gray-50">
          <header class="bg-white shadow">
            <div class="max-w-7xl mx-auto px-4 py-6">
              <h1 class="text-3xl font-bold text-gray-900">LAZR Discrepancy Analysis</h1>
              <p class="text-gray-600 mt-1">\${state.data.orders.length} orders analyzed</p>
              
              <div class="flex gap-4 mt-6 border-b">
                <button onclick="state.activeTab='client'; render()" class="pb-2 \${state.activeTab === 'client' ? 'tab-active' : 'tab-inactive'} font-semibold">
                  📈 Client Side (Selling Price)
                </button>
                <button onclick="state.activeTab='carrier'; render()" class="pb-2 \${state.activeTab === 'carrier' ? 'tab-active' : 'tab-inactive'} font-semibold">
                  🚚 Carrier Side (Cost)
                </button>
              </div>
            </div>
          </header>

          <main class="max-w-7xl mx-auto px-4 py-8">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <div class="bg-white p-4 rounded-lg shadow">
                <div class="text-sm text-gray-600">Total Orders</div>
                <div class="text-2xl font-bold text-gray-900">\${state.filtered.length}</div>
              </div>
              <div class="bg-white p-4 rounded-lg shadow">
                <div class="text-sm text-gray-600">\${state.activeTab === 'client' ? 'Customers' : 'Carriers'}</div>
                <div class="text-2xl font-bold text-gray-900">\${stats.length}</div>
              </div>
              <div class="bg-white p-4 rounded-lg shadow">
                <div class="text-sm text-gray-600">Net Discrepancy</div>
                <div class="text-2xl font-bold \${totalDisc >= 0 ? 'text-red-600' : 'text-green-600'}">\$\${Math.abs(totalDisc).toFixed(2)}</div>
              </div>
              <div class="bg-white p-4 rounded-lg shadow">
                <div class="text-sm text-gray-600">Overcharges</div>
                <div class="text-2xl font-bold text-red-600">\${stats.reduce((s, c) => s + c.overcharges, 0)}</div>
              </div>
            </div>

            <div class="bg-white p-4 rounded-lg shadow mb-8">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Month</label>
                  <select onchange="state.selectedMonth = this.value; applyFilters()" class="w-full border rounded px-3 py-2">
                    <option value="">All Months</option>
                    \${months.map(m => \`<option value="\${m}">\${m}</option>\`).join('')}
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">\${state.activeTab === 'client' ? 'Customer' : 'Carrier'}</label>
                  <select onchange="state.selectedCustomer = this.value; applyFilters()" class="w-full border rounded px-3 py-2">
                    <option value="">All</option>
                    \${customers.map(c => \`<option value="\${c}">\${c}</option>\`).join('')}
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-2">Order Number</label>
                  <input type="text" placeholder="Search..." onchange="state.searchOrder = this.value; applyFilters()" class="w-full border rounded px-3 py-2">
                </div>
              </div>
            </div>

            <div class="bg-white rounded-lg shadow overflow-hidden">
              <table class="w-full">
                <thead class="bg-gray-100 border-b">
                  <tr>
                    <th class="px-6 py-3 text-left text-sm font-semibold text-gray-900">\${state.activeTab === 'client' ? 'Customer' : 'Carrier'}</th>
                    <th class="px-6 py-3 text-left text-sm font-semibold text-gray-900">Orders</th>
                    <th class="px-6 py-3 text-left text-sm font-semibold text-gray-900">\${state.activeTab === 'client' ? 'Total Selling' : 'Total Quoted'}</th>
                    <th class="px-6 py-3 text-left text-sm font-semibold text-gray-900">Total Billed</th>
                    <th class="px-6 py-3 text-left text-sm font-semibold text-gray-900">Discrepancy</th>
                    <th class="px-6 py-3 text-left text-sm font-semibold text-gray-900">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  \${stats.map(s => \`
                    <tr class="border-b hover:bg-gray-50">
                      <td class="px-6 py-3 text-sm text-gray-900">\${s.customer || s.carrier}</td>
                      <td class="px-6 py-3 text-sm text-gray-600">\${s.orders}</td>
                      <td class="px-6 py-3 text-sm text-gray-600">\$\${(s.totalSelling || s.totalQuoted).toFixed(2)}</td>
                      <td class="px-6 py-3 text-sm text-gray-600">\$\${s.totalBilled.toFixed(2)}</td>
                      <td class="px-6 py-3 text-sm font-semibold \${s.totalDiscrepancy >= 0 ? 'text-red-600' : 'text-green-600'}">\$\${Math.abs(s.totalDiscrepancy).toFixed(2)}</td>
                      <td class="px-6 py-3 text-sm text-gray-600">\${s.discrepancyRate.toFixed(2)}%</td>
                    </tr>
                  \`).join('')}
                </tbody>
              </table>
            </div>

            <div class="mt-8 bg-white rounded-lg shadow p-6">
              <h2 class="text-xl font-bold text-gray-900 mb-4">🤖 AI Analyst</h2>
              <div class="bg-gray-50 rounded p-4 mb-4 h-64 overflow-y-auto">
                \${state.messages.map(msg => \`
                  <div class="mb-3 \${msg.role === 'user' ? 'text-right' : 'text-left'}">
                    <div class="\${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-900'} inline-block rounded px-3 py-2 max-w-xs">
                      \${msg.content}
                    </div>
                  </div>
                \`).join('')}
              </div>
              <div class="flex gap-2">
                <input type="text" id="chatInput" placeholder="Ask about discrepancies..." class="flex-1 border rounded px-3 py-2">
                <button onclick="sendChatMessage()" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded">Send</button>
              </div>
            </div>
          </main>
        </div>
      \`;
    }

    render();
  </script>
</body>
</html>
  `;
}

module.exports = app;
