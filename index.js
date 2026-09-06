const http = require('http');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const QRCode = require('qrcode');
const OpenAI = require('openai');
const puppeteer = require('puppeteer');

let qrImageBase64 = '';

// Servidor HTTP para mostrar la imagen del QR en la web
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  
  if (qrImageBase64) {
    res.end(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Escanear QR WhatsApp</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body { font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f0f2f5; }
            .card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; }
            img { width: 280px; height: 280px; border: 1px solid #ddd; border-radius: 8px; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Escaneá el QR con WhatsApp</h2>
            <p>Dispositivos vinculados ➔ Vincular un dispositivo</p>
            <img src="${qrImageBase64}" alt="Código QR" />
          </div>
        </body>
      </html>
    `);
  } else {
    res.end('<h1>Bot Activo</h1><p>Si recién reiniciaste, actualizá la página en unos segundos. Si ya vinculaste el teléfono, WhatsApp está conectado.</p>');
  }
});

server.listen(port, () => {
  console.log(`Servidor HTTP activo en el puerto ${port}`);
});

// Variables de entorno
const supabaseUrl = process.env.SUPABASE_URL || process.env.supabase_url;
const supabaseKey = process.env.SUPABASE_KEY || process.env.api_key;
const openrouterKey = process.env.OPENROUTER_API_KEY || process.env.open_router_api_key;

const supabase = createClient(supabaseUrl, supabaseKey);
const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: openrouterKey,
});

function obtenerRutaChrome() {
  try {
    return puppeteer.executablePath();
  } catch (e) {
    const cachePath = path.join(process.cwd(), '.cache', 'puppeteer', 'chrome');
    if (fs.existsSync(cachePath)) {
      const folders = fs.readdirSync(cachePath);
      if (folders.length > 0) {
        return path.join(cachePath, folders[0], 'chrome-linux64', 'chrome');
      }
    }
    return '/opt/render/project/src/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome';
  }
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    executablePath: obtenerRutaChrome(),
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu'
    ]
  }
});

// Generación de la imagen limpia para la web
client.on('qr', async (qr) => {
  console.log('--- NUEVO CÓDIGO QR GENERADO ---');
  try {
    qrImageBase64 = await QRCode.toDataURL(qr);
    console.log('¡Ingresá a tu link de Render para ver la imagen del QR!');
  } catch (err) {
    console.error('Error al generar la imagen del QR:', err);
  }
  qrcodeTerminal.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('WhatsApp conectado y listo para enviar mensajes.');
  qrImageBase64 = '';
  procesarContactos();
});

client.initialize();

async function procesarContactos() {
  try {
    console.log('Consultando contactos pendientes en Supabase...');
    const { data: contactos, error } = await supabase
      .from('contactos')
      .select('*')
      .eq('estado', 'pendiente');

    if (error) {
      console.error('Error Supabase:', error.message);
      return;
    }

    const pendientes = (contactos || []).filter(c => c.telefono && c.telefono.trim() !== '');

    console.log(`Contactos a procesar por WhatsApp: ${pendientes.length}`);

    if (pendientes.length === 0) {
      console.log('No hay contactos pendientes con teléfono asignado.');
      return;
    }

    for (const contacto of pendientes) {
      let numeroLimpio = contacto.telefono.replace(/[^0-9]/g, '');
      const chatId = `${numeroLimpio}@c.us`;

      console.log(`Generando mensaje IA para: ${contacto.nombre}...`);

      let mensaje = '';
      try {
        const completion = await openrouter.chat.completions.create({
          model: 'meta-llama/llama-3.2-1b-instruct:free',
          messages: [
            {
              role: 'system',
              content: 'Sos un asesor comercial de TurnoDirecto. Escribí un mensaje de WhatsApp muy corto, directo y profesional ofreciendo un sistema de turnos para estéticas.'
            },
            {
              role: 'user',
              content: `Propuesta para: ${contacto.nombre}`
            }
          ]
        });
        mensaje = completion.choices[0].message.content;
      } catch (aiErr) {
        console.error('Error IA:', aiErr.message);
        mensaje = `Hola ${contacto.nombre}, te escribo de TurnoDirecto para mostrarte cómo optimizar los turnos de tu estética.`;
      }

      console.log(`Enviando WhatsApp a ${contacto.nombre} (${numeroLimpio})...`);
      await client.sendMessage(chatId, mensaje);

      await supabase
        .from('contactos')
        .update({ estado: 'enviado' })
        .eq('id', contacto.id);

      console.log(`Mensaje enviado con éxito a ${contacto.nombre}!`);
      
      await new Promise(res => setTimeout(res, 10000));
    }
  } catch (err) {
    console.error('Error en ejecución:', err.message || err);
  }
}
