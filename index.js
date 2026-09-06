const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const OpenAI = require('openai');

const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Bot de TurnoDirecto en vivo!\n');
});

server.listen(port, () => {
  console.log(`Servidor HTTP activo en puerto ${port}`);
  iniciarBot();
});

// Lectura de variables con fallbacks
const supabaseUrl = process.env.SUPABASE_URL || process.env.supabase_url;
const supabaseKey = process.env.SUPABASE_KEY || process.env.api_key;
const resendKey = process.env.RESEND_API_KEY || process.env.recent_api_key;
const openrouterKey = process.env.OPENROUTER_API_KEY || process.env.open_router_api_key;

async function iniciarBot() {
  // Validacion previa
  if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: Falta configurar SUPABASE_URL o SUPABASE_KEY en Render (Environment).');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const resend = new Resend(resendKey);
  const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: openrouterKey,
  });

  try {
    console.log('Buscando contactos pendientes...');
    const { data: contactos, error } = await supabase
      .from('contactos')
      .select('*')
      .eq('estado', 'pendiente')
      .not('email', 'is', null);

    if (error) {
      console.error('Error al consultar Supabase:', error.message);
      return;
    }

    if (!contactos || contactos.length === 0) {
      console.log('No hay contactos pendientes con email para procesar.');
      return;
    }

    console.log(`Procesando ${contactos.length} contacto(s)...`);

    for (const contacto of contactos) {
      console.log(`Enviando propuesta a: ${contacto.nombre} (${contacto.email})`);

      const completion = await openrouter.chat.completions.create({
        model: 'openai/gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'Sos un experto en marketing para centros de estética en Argentina. Ofrecés "TurnoDirecto", un sistema para agendar turnos. Redactá un mail muy corto y directo.'
          },
          {
            role: 'user',
            content: `Propuesta para: ${contacto.nombre}`
          }
        ]
      });

      const mensaje = completion.choices[0].message.content;

      await resend.emails.send({
        from: 'onboarding@resend.dev',
        to: contacto.email,
        subject: `Propuesta para ${contacto.nombre}`,
        text: mensaje
      });

      await supabase
        .from('contactos')
        .update({ estado: 'enviado' })
        .eq('id', contacto.id);

      console.log(`Mail enviado con exito a ${contacto.email}`);
    }
  } catch (err) {
    console.error('Error en ejecución:', err.message || err);
  }
}
