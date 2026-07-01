const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principal (por si alguien entra sin el archivo)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Almacenar clientes
const clients = new Set();

wss.on('connection', (ws) => {
  const clientId = 'Vecino-' + Math.floor(Math.random() * 10000);
  clients.add(ws);
  console.log(`🟢 Conectado: ${clientId} (${clients.size} en línea)`);

  // Notificar a todos la nueva cantidad
  broadcast({
    type: 'UPDATE_DEVICES',
    count: clients.size,
    devices: Array.from(clients).map((_, i) => `Vecino-${i+1}`)
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log(`📨 ${clientId}:`, data.type);

      // Reenviar a TODOS los clientes
      broadcast({
        ...data,
        from: clientId,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      console.error('Error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`🔴 Desconectado: ${clientId} (${clients.size} restantes)`);
    broadcast({
      type: 'UPDATE_DEVICES',
      count: clients.size,
      devices: Array.from(clients).map((_, i) => `Vecino-${i+1}`)
    });
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📱 Comparte esta URL con tus vecinos`);
});