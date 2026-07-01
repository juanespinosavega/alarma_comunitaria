const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Crear carpeta data si no existe
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}

// Archivo de historial
const historialFile = path.join(dataDir, 'historial.json');

// Función para leer historial
function leerHistorial() {
  try {
    if (fs.existsSync(historialFile)) {
      const data = fs.readFileSync(historialFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {
    console.error('Error al leer historial:', e);
  }
  return [];
}

// Función para guardar en historial
function guardarHistorial(evento) {
  try {
    const historial = leerHistorial();
    historial.push({
      ...evento,
      timestamp: new Date().toISOString()
    });
    // Mantener solo los últimos 500 eventos
    if (historial.length > 500) {
      historial.splice(0, historial.length - 500);
    }
    fs.writeFileSync(historialFile, JSON.stringify(historial, null, 2));
  } catch (e) {
    console.error('Error al guardar historial:', e);
  }
}

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Ruta para obtener historial (API)
app.get('/api/historial', (req, res) => {
  const historial = leerHistorial();
  // Filtrar por PIN si se envía
  const pin = req.query.pin;
  if (pin) {
    // Solo devolver eventos si el PIN es correcto
    const historialFiltrado = historial.filter(e => e.pin === pin);
    return res.json(historialFiltrado);
  }
  res.json(historial);
});

// Ruta principal
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- WEBSOCKET ----------
const clients = new Map(); // guardamos el PIN por cliente

wss.on('connection', (ws) => {
  const clientId = 'Vecino-' + Math.floor(Math.random() * 10000);
  clients.set(ws, { id: clientId, pin: null, ubicacion: null });
  
  console.log(`🟢 Conectado: ${clientId} (${clients.size} en línea)`);

  // Notificar actualización de dispositivos
  broadcast({
    type: 'UPDATE_DEVICES',
    count: clients.size,
    devices: Array.from(clients.values()).map(c => c.id)
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      const clientData = clients.get(ws);
      
      console.log(`📨 ${clientData.id}:`, data.type);

      // Manejar registro de PIN
      if (data.type === 'REGISTRAR_PIN') {
        clientData.pin = data.pin;
        clientData.ubicacion = data.ubicacion || null;
        clients.set(ws, clientData);
        ws.send(JSON.stringify({
          type: 'PIN_REGISTRADO',
          success: true,
          message: 'PIN registrado correctamente'
        }));
        return;
      }

      // Verificar PIN para acciones de alarma
      if (data.type === 'ALARMA_ACTIVADA' || data.type === 'ALARMA_DESACTIVADA') {
        // El PIN debe venir en el mensaje
        const pinIngresado = data.pin;
        const pinCorrecto = '1234'; // PIN fijo (cámbialo por el que quieras)
        
        if (pinIngresado !== pinCorrecto) {
          ws.send(JSON.stringify({
            type: 'ERROR_PIN',
            message: 'PIN incorrecto. No autorizado.'
          }));
          return;
        }

        // Guardar en historial
        const evento = {
          tipo: data.type,
          dispositivo: clientData.id,
          pin: pinIngresado,
          ubicacion: clientData.ubicacion || data.ubicacion || null,
          lat: data.lat || null,
          lng: data.lng || null
        };
        guardarHistorial(evento);

        // Reenviar a TODOS
        broadcast({
          ...data,
          from: clientData.id,
          ubicacion: clientData.ubicacion || data.ubicacion || null,
          timestamp: new Date().toISOString()
        });
        return;
      }

      // Mensaje genérico
      if (data.from) {
        broadcast(data);
      }
    } catch (e) {
      console.error('Error:', e);
      ws.send(JSON.stringify({
        type: 'ERROR',
        message: 'Error al procesar mensaje'
      }));
    }
  });

  ws.on('close', () => {
    const clientData = clients.get(ws);
    clients.delete(ws);
    console.log(`🔴 Desconectado: ${clientData?.id || 'desconocido'} (${clients.size} restantes)`);
    broadcast({
      type: 'UPDATE_DEVICES',
      count: clients.size,
      devices: Array.from(clients.values()).map(c => c.id)
    });
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach((_, client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
  console.log(`📱 Comparte esta URL con tus vecinos`);
  console.log(`🔑 PIN por defecto: 1234 (cámbialo en server.js)`);
});
