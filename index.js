const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const OpenAI = require('openai');

// 1. Servidor HTTP básico para Render
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Bot de TurnoDirecto en vivo y corriendo!\n');
});

server.listen(port, () => {
  console.log(`Servidor HTTP activo en el puerto ${port}`);
  console.log('Bot de TurnoDirecto listo para operar!');
  ejecutarBot();
});

// 2. Clientes adaptados a tus nombres de variables en Render
const supabaseUrl = process.env.SUPABASE_URL || process.env.supabase_url;
const supabaseKey = process.env.SUPABASE_KEY || process.env.api_key;
const resendKey = process.env.RESEND_API_KEY || process.env.recent_api_key;
const openrouterKey = process.env.OPENROUTER_API_KEY || process.env.open_router_api_key;

const supabase = createClient(supabaseUrl, supabaseKey);
const resend = new Resend(resendKey);
const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: openrouterKey,
});

// 3. Lógica principal del Bot
async function ejecutarBot() {
  try {
    console.log('Buscando contactos pendientes en Supabase...');

    const { data: contactos, error } = await supabase
      .from('contactos')
      .select('*')
      .eq('estado', 'pendiente')
      .not('email', 'is', null);

    if (error) {
      console.error('Error al consultar Supabase:', error);
      return;
    }

    if (!contactos || contactos.length === 0) {
      console.log('No hay contactos pendientes con email para procesar.');
      return;
    }

    console.log(`Se encontraron ${contactos.length} contacto(s) para procesar.`);

    for (const contacto of contactos) {
      console.log(`\nProcesando: ${contacto.nombre} (${contacto.email})...`);

      const completion = await openrouter.chat.completions.create({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'Sos un experto en marketing para centros de estética en Argentina. Tu objetivo es vender "TurnoDirecto", un sistema automatizado para agendar turnos y conseguir clientes. Redactá un mail súper corto, profesional, directo y amable.'
          },
          {
            role: 'user',
            content: `Armale una propuesta corta para el centro de estética llamado: "${contacto.nombre}".`
          }
        ]
      });

      const mensajeIA = completion.choices[0].message.content;

      const emailResult = await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: contacto.email,
        subject: `Propuesta de automatización para ${contacto.nombre}`,
        text: mensajeIA
      });

      console.log(`Mail enviado con éxito a ${contacto.email}! ID:`, emailResult.id);

      await supabase
        .from('contactos')
        .update({ estado: 'enviado' })
        .eq('id', contacto.id);

      console.log(`Estado de ${contacto.nombre} actualizado a "enviado".`);
    }

  } catch (err) {
    console.error('Error durante la ejecución del bot:', err);
  }
}

process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', err);
});
