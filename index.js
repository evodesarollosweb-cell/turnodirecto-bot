const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 10000;

// --- Validación de variables de entorno al arrancar ---
const requiredEnvVars = ['SUPABASE_URL', 'SUPABASE_KEY'];
for (const key of requiredEnvVars) {
  if (!process.env[key]) {
    console.error(`Falta la variable de entorno ${key}. Abortando.`);
    process.exit(1);
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

let ultimoQrTexto = '';
let estaConectado = false;
let procesandoCiclo = false; // evita ciclos superpuestos

const client = new Client({
  authStrategy: new LocalAuth({ clientId: "turnodirecto-session" }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || require('puppeteer').executablePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-extensions',
      '--blink-settings=imagesEnabled=false', // no cargar imágenes: baja bastante el consumo de RAM
      '--js-flags=--max-old-space-size=200'   // limita la memoria que usa el motor JS de Chrome
    ]
  }
});

client.on('qr', (qr) => {
  if (!estaConectado) {
    console.log('¡Nuevo QR generado en texto!');
    ultimoQrTexto = qr;
  }
});

client.on('ready', () => {
  if (!estaConectado) {
    estaConectado = true;
    console.log('WhatsApp conectado y listo para enviar mensajes.');
    ultimoQrTexto = '';

    iniciarProcesamiento();

    setInterval(() => {
      if (procesandoCiclo) {
        console.log('Ciclo anterior todavía en curso, se omite este disparo.');
        return;
      }
      console.log('Iniciando ciclo automático de revisión en Supabase...');
      iniciarProcesamiento();
    }, 20 * 60 * 1000);
  }
});

client.on('auth_failure', (msg) => {
  console.error('Fallo de autenticación en WhatsApp:', msg);
});

// Evita que errores puntuales de Puppeteer/WhatsApp Web (que no rompen
// el envío en sí) tumben todo el proceso de Node innecesariamente.
process.on('unhandledRejection', (err) => {
  console.error('⚠️ Promesa rechazada sin manejar (no se reinicia el proceso):', err.message || err);
});

client.on('disconnected', (reason) => {
  console.log('WhatsApp desconectado:', reason);
  estaConectado = false;
});

app.get('/qr', async (req, res) => {
  if (estaConectado) {
    return res.send(`
      <html>
        <body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f2f5;font-family:sans-serif;">
          <div style="text-align:center;background:white;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
            <h2 style="color: green;">¡WhatsApp ya está conectado!</h2>
            <p>El bot está operando normalmente y procesando la base de datos.</p>
          </div>
        </body>
      </html>
    `);
  }

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
      console.error('Error generando QR:', e);
      res.send('Error generando la imagen del QR.');
    }
  } else {
    res.send(`
      <html>
        <body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#f0f2f5;font-family:sans-serif;">
          <div style="text-align:center;background:white;padding:30px;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
            <h2>Generando código QR...</h2>
            <p>Actualizá esta página en unos segundos.</p>
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
  const segundos = Math.floor(Math.random() * (maxSegundos - minSegundos + 1)) + minSegundos;
  return new Promise(resolve => setTimeout(() => resolve(segundos), segundos * 1000));
}

// Genera el mensaje sin depender de ninguna IA externa: usa el nombre
// que ya está cargado en Supabase e inserta pequeñas variaciones para
// que el texto no sea 100% idéntico en cada envío.
function generarMensajeFijo(nombreContacto) {
  const saludos = ['¡Hola!', 'Hola, ¿cómo andan?', 'Buenas!'];
  const cierres = [
    '¿Cómo se están organizando con la agenda hoy en día?',
    '¿Cómo llevan hoy el tema de los turnos?',
    '¿Cómo vienen manejando la agenda actualmente?',
  ];

  const saludo = saludos[Math.floor(Math.random() * saludos.length)];
  const cierre = cierres[Math.floor(Math.random() * cierres.length)];

  return `${saludo} Estuve viendo el perfil de ${nombreContacto} y les escribo porque armé Tornero (https://turnero-est.base44.app), un sistema de turnos online pensado específicamente para estéticas. Básicamente les ahorra el estar respondiendo mensajes a mano todo el día y les frena los plantones de última hora. ${cierre}`;
}

async function procesarContacto(contacto) {
  // Validación de teléfono
  if (!contacto.telefono || String(contacto.telefono).trim() === '') {
    console.log(`Contacto ${contacto.nombre} sin teléfono. Omitiendo...`);
    await supabase.from('contactos').update({ estado: 'sin_telefono' }).eq('id', contacto.id);
    return;
  }

  const numeroLimpio = String(contacto.telefono).replace(/\D/g, '');
  if (numeroLimpio.length < 8) {
    console.log(`Contacto ${contacto.nombre} tiene un número inválido. Omitiendo...`);
    await supabase.from('contactos').update({ estado: 'telefono_invalido' }).eq('id', contacto.id);
    return;
  }

  const chatId = `${numeroLimpio}@c.us`;

  try {
    console.log(`Generando mensaje para: ${contacto.nombre}...`);
    const mensajeAI = generarMensajeFijo(contacto.nombre);

    console.log(`Enviando WhatsApp a ${contacto.nombre} (${numeroLimpio})...`);
    await client.sendMessage(chatId, mensajeAI);

    await supabase
      .from('contactos')
      .update({ estado: 'enviado', mensaje_enviado: mensajeAI, fecha_envio: new Date().toISOString() })
      .eq('id', contacto.id);

    console.log(`✅ Mensaje enviado a ${contacto.nombre}`);
  } catch (err) {
    // Un fallo puntual (IA caída, número sin WhatsApp, etc.) no debe frenar el resto del lote
    console.error(`❌ Error procesando a ${contacto.nombre}:`, err.message || err);
    await supabase
      .from('contactos')
      .update({ estado: 'error_envio' })
      .eq('id', contacto.id);
  }
}

async function iniciarProcesamiento() {
  if (procesandoCiclo) {
    console.log('Ya hay un procesamiento en curso, se omite.');
    return;
  }
  procesandoCiclo = true;

  try {
    console.log('Consultando contactos pendientes en Supabase...');
    const { data: contactos, error } = await supabase
      .from('contactos')
      .select('*')
      .eq('estado', 'pendiente');

    if (error) {
      console.error('Error al obtener contactos de Supabase:', error);
      return;
    }

    if (!contactos || contactos.length === 0) {
      console.log('No hay contactos pendientes para enviar.');
      return;
    }

    console.log(`Contactos pendientes en total: ${contactos.length}`);

    // Límite de mensajes por ciclo, para no mandar todo de golpe.
    // El resto queda 'pendiente' y se manda en los ciclos siguientes.
    const MAX_POR_CICLO = 5;
    const loteAEnviar = contactos.slice(0, MAX_POR_CICLO);
    console.log(`Enviando ${loteAEnviar.length} de ${contactos.length} en este ciclo...`);

    for (const contacto of loteAEnviar) {
      await procesarContacto(contacto);

      const segundosEsperados = await obtenerDelayAleatorio(90, 240);
      console.log(`Esperando ${segundosEsperados} segundos antes del próximo envío...`);
    }

    console.log('🎉 Lote de este ciclo procesado.');
  } catch (err) {
    console.error('Error durante el procesamiento:', err);
  } finally {
    procesandoCiclo = false;
  }
}

client.initialize();
