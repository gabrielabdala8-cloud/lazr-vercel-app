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
  <style>
    .hidden { display: none; }
  </style>
</head>
<body class="bg-gray-50">
  <div id="app"></div>

  <script>
    const state = {
      data: null,
      filtered: [],
      selectedMonth: '',
      selectedCustomer: '',
      searchOrder: '',
      showChat: false,
      messages: []
    };

    function parseCSV(text) {
      const lines = text.trim().split('\\n');
      const headers = lines[0].split(',').map(h => h.trim().toUpperCase());
      
      const orderNumberIdx = headers.findIndex(h => h.includes('ORDER'));
      const customerIdx = headers.findIndex(h => h.includes('CUSTOMER') || h.includes('SHIPPER'));
      const dateIdx = headers.findIndex(h => h.includes('DATE'));
      const transportIdx = headers.findIndex(h => h.includes('TRANSPORT') || h.includes('MODE'));
      const serviceIdx = headers.findIndex(h => h.includes('SERVICE'));
      const carrierIdx = headers.findIndex(h => h.includes('CARRIER'));
      const laneIdx = headers.findIndex(h => h.includes('LANE') || h.includes('ROUTE'));
      const originIdx = headers.findIndex(h => h.includes('ORIGIN'));
      const destIdx = headers.findIndex(h => h.includes('DEST'));
      const sellingIdx = headers.findIndex(h => h.includes('SELLING') || h.includes('QUOTED'));
      const billedIdx = headers.findIndex(h => h.includes('BILLED') || h.includes('INVOICED'));

      const orders = [];
      const customerMap = new Map();
      let minDate = '2099-12-31';
      let maxDate = '1900-01-01';

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cols = line.split(',').map(c => c.trim());
        
        const orderNumber = cols[orderNumberIdx]?.trim() || \`ORDER_\${i}\`;
        const customer = cols[customerIdx]?.trim() || 'Unknown';
        const date = cols[dateIdx]?.trim() || '2025-01-01';
        const month = date.substring(0, 7);
        const transportType = cols[transportIdx]?.trim() || 'Unknown';
        const serviceType = cols[serviceIdx]?.trim() || 'Standard';
        const carrier = cols[carrierIdx]?.trim() || 'Unknown';
        const lane = cols[laneIdx]?.trim() || 'N/A';
        const originCountry = cols[originIdx]?.trim() || 'Unknown';
        const destCountry = cols[destIdx]?.trim() || 'Unknown';
        
        const selling = parseFloat(cols[sellingIdx]) || 0;
        const billed = parseFloat(cols[billedIdx]) || 0;
        const discrepancy = billed - selling;
        const margin = selling > 0 ? ((billed - selling) / selling) * 100 : 0;
        
        const flag = Math.abs(discrepancy) < 0.01 ? 'match' :
          discrepancy > 0 ? 'overcharge' : 'undercharge';

        const order = {
          orderNumber, customer, date, month, transportType, serviceType,
          carrier, lane, originCountry, destCountry, sellingPrice: selling,
          billedPrice: billed, discrepancy, margin, marginPct: margin, flag
        };

        orders.push(order);
        minDate = date < minDate ? date : minDate;
        maxDate = date > maxDate ? date : maxDate;

        if (!customerMap.has(customer)) {
          customerMap.set(customer, {
            customer, orders: 0, totalSelling: 0, totalBilled: 0,
            totalDiscrepancy: 0, overcharges: 0, undercharges: 0,
            matches: 0, discrepancyRate: 0, severity: 'green'
          });
        }

        const stat = customerMap.get(customer);
        stat.orders++;
        stat.totalSelling += selling;
        stat.totalBilled += billed;
        stat.totalDiscrepancy += discrepancy;
        if (flag === 'overcharge') stat.overcharges++;
        else if (flag === 'undercharge') stat.undercharges++;
        else stat.matches++;
      }

      const stats = Array.from(customerMap.values()).map(s => ({
        ...s,
        totalDiscrepancy: Math.round(s.totalDiscrepancy * 100) / 100,
        discrepancyRate: s.totalSelling > 0 ? (s.totalDiscrepancy / s.totalSelling) * 100 : 0,
        severity: Math.abs(s.totalDiscrepancy) < 50 ? 'green' :
          Math.abs(s.totalDiscrepancy) < 500 ? 'yellow' : 'red'
      })).sort((a, b) => Math.abs(b.totalDiscrepancy) - Math.abs(a.totalDiscrepancy));

      return { orders, stats, dateRange: { from: minDate, to: maxDate } };
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

      await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          stats: state.data.stats,
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

      const totalDisc = state.data.stats.reduce((s, c) => s + c.totalDiscrepancy, 0);
      const context = \`You are a logistics billing analyst. You have access to discrepancy data:
- Total orders: \${state.filtered.length}
- Total customers: \${state.data.stats.length}
- Net discrepancy: \$\${totalDisc.toFixed(2)}
- Overcharges: \${state.data.stats.reduce((s, c) => s + c.overcharges, 0)}
- Undercharges: \${state.data.stats.reduce((s, c) => s + c.undercharges, 0)}

Top customers by discrepancy:
\${state.data.stats.slice(0, 5).map((s) => \`- \${s.customer}: \$\${s.totalDiscrepancy.toFixed(2)} (\${s.orders} orders)\`).join('\\n')}

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
                <p class="text-gray-600 mb-6">Upload your LAZR export CSV</p>
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

      const stats = state.data.stats.filter(s => {
        if (state.selectedMonth) {
          const hasMonth = state.filtered.some(o => o.customer === s.customer && o.month === state.selectedMonth);
          if (!hasMonth) return false;
        }
        if (state.selectedCustomer && s.customer !== state.selectedCustomer) return false;
        return true;
      });

      const totalDisc = stats.reduce((s, c) => s + c.totalDiscrepancy, 0);
      const months = [...new Set(state.data.orders.map(o => o.month))].sort().reverse();
      const customers = [...new Set(state.data.orders.map(o => o.customer))].sort();

      app.innerHTML = \`
        <div class="min-h-screen bg-gray-50">
          <header class="bg-white shadow">
            <div class="max-w-7xl mx-auto px-4 py-6">
              <h1 class="text-3xl font-bold text-gray-900">LAZR Discrepancy Analysis</h1>
              <p class="text-gray-600 mt-1">\${state.data.orders.length} orders analyzed</p>
            </div>
          </header>

          <main class="max-w-7xl mx-auto px-4 py-8">
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
              <div class="bg-white p-4 rounded-lg shadow">
                <div class="text-sm text-gray-600">Total Orders</div>
                <div class="text-2xl font-bold text-gray-900">\${state.filtered.length}</div>
              </div>
              <div class="bg-white p-4 rounded-lg shadow">
                <div class="text-sm text-gray-600">Customers</div>
                <div class="text-2xl font-bold text-gray-900">\${stats.length}</div>
              </div>
              <div class="bg-white p-4 rounded-lg shadow border-l-4 border-red-500">
                <div class="text-sm text-gray-600">Net Discrepancy</div>
                <div class="text-2xl font-bold text-red-600">\$\${totalDisc.toFixed(2)}</div>
              </div>
              <div class="bg-white p-4 rounded-lg shadow">
                <div class="text-sm text-gray-600">Overcharges</div>
                <div class="text-2xl font-bold text-red-600">\${stats.reduce((s, c) => s + c.overcharges, 0)}</div>
              </div>
              <div class="bg-white p-4 rounded-lg shadow">
                <div class="text-sm text-gray-600">Undercharges</div>
                <div class="text-2xl font-bold text-green-600">\${stats.reduce((s, c) => s + c.undercharges, 0)}</div>
              </div>
              <div class="bg-white p-4 rounded-lg shadow">
                <div class="text-sm text-gray-600">Critical</div>
                <div class="text-2xl font-bold text-orange-600">\${stats.filter(c => c.severity === 'red').length}</div>
              </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <div class="lg:col-span-3">
                <div class="bg-white p-6 rounded-lg shadow mb-6">
                  <h2 class="text-lg font-bold text-gray-900 mb-4">Filters</h2>
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-2">Month</label>
                      <select onchange="state.selectedMonth = this.value; applyFilters()" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                        <option value="">All Months</option>
                        \${months.map(m => \`<option value="\${m}">\${m}</option>\`).join('')}
                      </select>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-2">Customer</label>
                      <select onchange="state.selectedCustomer = this.value; applyFilters()" class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                        <option value="">All Customers</option>
                        \${customers.map(c => \`<option value="\${c}">\${c}</option>\`).join('')}
                      </select>
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-2">Order Number</label>
                      <input type="text" onchange="state.searchOrder = this.value; applyFilters()" placeholder="Search..." class="w-full px-3 py-2 border border-gray-300 rounded-lg">
                    </div>
                  </div>
                </div>

                <div class="bg-white rounded-lg shadow overflow-hidden">
                  <div class="overflow-x-auto">
                    <table class="w-full">
                      <thead class="bg-gray-100 border-b">
                        <tr>
                          <th class="px-4 py-3 text-left text-sm font-semibold">Order #</th>
                          <th class="px-4 py-3 text-left text-sm font-semibold">Customer</th>
                          <th class="px-4 py-3 text-left text-sm font-semibold">Date</th>
                          <th class="px-4 py-3 text-left text-sm font-semibold">Carrier</th>
                          <th class="px-4 py-3 text-right text-sm font-semibold">Selling</th>
                          <th class="px-4 py-3 text-right text-sm font-semibold">Billed</th>
                          <th class="px-4 py-3 text-right text-sm font-semibold">Discrepancy</th>
                          <th class="px-4 py-3 text-center text-sm font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        \${state.filtered.slice(0, 50).map((order, idx) => \`
                          <tr class="border-b hover:bg-gray-50">
                            <td class="px-4 py-3 text-sm font-mono">\${order.orderNumber}</td>
                            <td class="px-4 py-3 text-sm">\${order.customer}</td>
                            <td class="px-4 py-3 text-sm">\${order.date}</td>
                            <td class="px-4 py-3 text-sm">\${order.carrier}</td>
                            <td class="px-4 py-3 text-sm text-right">\$\${order.sellingPrice.toFixed(2)}</td>
                            <td class="px-4 py-3 text-sm text-right">\$\${order.billedPrice.toFixed(2)}</td>
                            <td class="px-4 py-3 text-sm text-right font-semibold \${order.discrepancy > 0 ? 'text-red-600' : order.discrepancy < 0 ? 'text-green-600' : 'text-gray-600'}">\$\${order.discrepancy.toFixed(2)}</td>
                            <td class="px-4 py-3 text-center">
                              <span class="px-2 py-1 rounded text-xs font-semibold \${order.flag === 'overcharge' ? 'bg-red-100 text-red-800' : order.flag === 'undercharge' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}">\${order.flag}</span>
                            </td>
                          </tr>
                        \`).join('')}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div class="lg:col-span-1">
                <button onclick="state.showChat = !state.showChat; render()" class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-lg mb-4">
                  🤖 AI Agent
                </button>

                \${state.showChat ? \`
                  <div class="bg-white rounded-lg shadow flex flex-col h-96">
                    <div class="flex-1 overflow-y-auto p-4 space-y-4">
                      \${state.messages.length === 0 ? '<div class="text-center text-gray-500 text-sm py-8">Ask me about discrepancies</div>' : state.messages.map((msg, idx) => \`
                        <div class="flex \${msg.role === 'user' ? 'justify-end' : 'justify-start'}">
                          <div class="max-w-xs px-3 py-2 rounded-lg text-sm \${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-900'}">\${msg.content}</div>
                        </div>
                      \`).join('')}
                    </div>
                    <div class="border-t p-3">
                      <div class="flex gap-2">
                        <input type="text" id="chatInput" placeholder="Ask..." onkeypress="if(event.key==='Enter') sendChatMessage()" class="flex-1 px-3 py-2 border border-gray-300 rounded text-sm">
                        <button onclick="sendChatMessage()" class="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded text-sm">Send</button>
                      </div>
                    </div>
                  </div>
                \` : ''}
              </div>
            </div>
          </main>
        </div>
      \`;
    }

    render();
  </script>
</body>
</html>`;
}
