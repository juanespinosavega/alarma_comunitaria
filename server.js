const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ---------- HISTORIAL FUERA DE LA CARPETA ----------
// Usamos la carpeta /tmp en Render (persiste mientras el servicio está activo)
// O puedes usar la ruta absoluta que quieras
const HISTORIAL_DIR = process.env.HISTORIAL_DIR || '/tmp/alarma-historial';
const historialFile = path.join(HISTORIAL_DIR, 'historial.json');

// Crear directorio si no existe
if (!fs.existsSync(HISTORIAL_DIR)) {
  fs.mkdirSync(HISTORIAL_DIR, { recursive: true });
}

// ---------- FUNCIONES DE HISTORIAL ----------
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

function guardarHistorial(evento) {
  try {
    const historial = leerHistorial();
    historial.push({
      ...evento,
      timestamp: new Date().toISOString()
    });
    // Mantener últimos 1000 eventos
    if (historial.length > 1000) {
      historial.splice(0, historial.length - 1000);
    }
    fs.writeFileSync(historialFile, JSON.stringify(historial, null, 2));
    console.log(`📝 Historial guardado: ${evento.tipo} por ${evento.dispositivo}`);
    console.log(`📁 Ubicación: ${historialFile}`);
  } catch (e) {
    console.error('Error al guardar historial:', e);
  }
}

// ---------- RUTAS API ----------
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/historial', (req, res) => {
  const historial = leerHistorial();
  const ultimos = historial.slice(-100);
  res.json(ultimos);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------- WEBSOCKET ----------
const clients = new Map();
const PIN_CORRECTO = '1234'; // Cambia este PIN

wss.on('connection', (ws) => {
  const clientId = 'Vecino-' + Math.floor(Math.random() * 10000);
  clients.set(ws, { id: clientId, pin: null, ubicacion: null });
  
  console.log(`🟢 Conectado: ${clientId} (${clients.size} en línea)`);

  // Enviar historial al conectar
  const historial = leerHistorial();
  const ultimos = historial.slice(-50);
  ws.send(JSON.stringify({
    type: 'HISTORIAL_INICIAL',
    data: ultimos
  }));

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

      if (data.type === 'ALARMA_ACTIVADA' || data.type === 'ALARMA_DESACTIVADA') {
        const pinIngresado = data.pin;
        
        if (pinIngresado !== PIN_CORRECTO) {
          ws.send(JSON.stringify({
            type: 'ERROR_PIN',
            message: 'PIN incorrecto. No autorizado.'
          }));
          return;
        }

        const evento = {
          tipo: data.type,
          dispositivo: clientData.id,
          pin: pinIngresado,
          ubicacion: clientData.ubicacion || data.ubicacion || null,
          lat: data.lat || null,
          lng: data.lng || null
        };
        guardarHistorial(evento);

        const historialActualizado = leerHistorial();
        const ultimosEventos = historialActualizado.slice(-50);

        // ENVIAR A TODOS CON EL HISTORIAL ACTUALIZADO
        broadcast({
          ...data,
          from: clientData.id,
          ubicacion: clientData.ubicacion || data.ubicacion || null,
          timestamp: new Date().toISOString(),
          historial: ultimosEventos,
          // AÑADIR SONIDO FORZADO
          forceSound: true,
          soundType: data.type === 'ALARMA_ACTIVADA' ? 'alarma' : 'off'
        });
        return;
      }

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
  console.log(`📁 Historial guardado en: ${historialFile}`);
  console.log(`🔑 PIN: ${PIN_CORRECTO}`);
});
