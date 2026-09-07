const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

const app = express();
const port = process.env.PORT || 10000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const openai = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
});

let ultimoQrTexto = '';

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: '/opt/render/project/src/.cache/puppeteer/chrome/linux-127.0.6533.88/chrome-linux64/chrome',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-extensions'
    ]
  }
});

client.on('qr', (qr) => {
  console.log('¡Nuevo QR generado en texto!');
  ultimoQrTexto = qr;
});

client.on('ready', () => {
  console.log('WhatsApp conectado y listo para enviar mensajes.');
  ultimoQrTexto = '';
  
  // Ejecuta al arrancar
  iniciarProcesamiento();

  // Vuelve a revisar Supabase cada 5 minutos automáticamente
  setInterval(() => {
    console.log('Iniciando ciclo automático de revisión en Supabase...');
    iniciarProcesamiento();
  }, 5 * 60 * 1000);
});

app.get('/qr', async (req, res) => {
  if (ultimoQrTexto) {
    try {
      const urlImagen = await qrcode.toDataURL(ultimoQrTexto);
      res.send(`
        <html>
          <body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f2f5;font-family:sans-serif;">
            <div style="text-align:center;background:white;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
              <h2>Escaneá el QR con WhatsApp</h2>
              <img src="${urlImagen}" style="width:280px;height:280px;"/>
            </div>
          </body>
        </html>
      `);
    } catch (e) {
      res.send('Error generando la imagen del QR.');
    }
  } else {
    res.send(`
      <html>
        <body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f2f5;font-family:sans-serif;">
          <div style="text-align:center;background:white;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
            <h2>WhatsApp ya está conectado o esperando generación</h2>
            <p>Si los logs dicen "Nuevo QR generado", recargá esta página en 5 segundos.</p>
          </div>
        </body>
      </html>
    `);
  }
});

app.get('/', (req, res) => {
  res.send('Servidor activo. Entrá a <a href="/qr">/qr</a> para ver el código.');
});

app.listen(port, () => {
  console.log(`Servidor HTTP activo en el puerto ${port}`);
});

function obtenerDelayAleatorio(minSegundos, maxSegundos) {
  const ms = Math.floor(Math.random() * (maxSegundos - minSegundos + 1) + minSegundos) * 1000;
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function iniciarProcesamiento() {
  try {
    console.log('Consultando contactos pendientes con teléfono en Supabase...');
    const { data: contactos, error } = await supabase
      .from('contactos')
      .select('*')
      .eq('estado', 'pendiente')
      .not('telefono', 'is', null);

    if (error) {
      console.error('Error al obtener contactos de Supabase:', error);
      return;
    }

    if (!contactos || contactos.length === 0) {
      console.log('No hay contactos pendientes con teléfono válidos para enviar.');
      return;
    }

    console.log(`Contactos a procesar: ${contactos.length}`);

    for (const contacto of contactos) {
      let numeroLimpio = String(contacto.telefono).replace(/\D/g, '');
      if (!numeroLimpio) {
        console.log(`Contacto ${contacto.nombre} tiene un teléfono inválido. Omitiendo...`);
        await supabase.from('contactos').update({ estado: 'sin_telefono' }).eq('id', contacto.id);
        continue;
      }

      const chatId = `${numeroLimpio}@c.us`;

      console.log(`Generando mensaje IA para: ${contacto.nombre}...`);

      const prompt = `Escribí un mensaje de WhatsApp amigable, corto y natural para dirigir a "${contacto.nombre}" (un centro de estética/clínica).
Basate estrictamente en este texto:
"Hola! ¿Cómo andan por ahí? Estuve chusmeando su centro y les escribo porque armé Tornero (https://turnero-est.base44.app), un sistema de turnos online pensado específicamente para estéticas. Básicamente les ahorra el estar respondiendo mensajes a mano todo el día y les frena los plantones de última hora. ¿Cómo se están organizando con la agenda hoy en día?"
Reglas:
- Mantené exactamente el sentido y la URL https://turnero-est.base44.app
- Tono conversacional, humano, sin formato corporativo pesado.`;

      const response = await openai.chat.completions.create({
        model: 'openai/gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
      });

      const mensajeAI = response.choices[0].message.content.trim();

      console.log(`Enviando WhatsApp a ${contacto.nombre} (${numeroLimpio})...`);
      await client.sendMessage(chatId, mensajeAI);

      await supabase
        .from('contactos')
        .update({ estado: 'enviado' })
        .eq('id', contacto.id);

      console.log(`✅ Mensaje enviado a ${contacto.nombre}`);

      const tiempoEspera = Math.floor(Math.random() * (50 - 25 + 1)) + 25;
      console.log(`Esperando ${tiempoEspera} segundos antes del próximo envío...`);
      await obtenerDelayAleatorio(25, 50);
    }

    console.log('🎉 Todos los contactos pendientes han sido procesados.');
  } catch (err) {
    console.error('Error durante el procesamiento:', err);
  }
}

client.initialize();
