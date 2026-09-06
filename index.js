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
  // Ejecutamos la función apenas arranca el servidor
  ejecutarBot();
});

// 2. Clientes de Supabase, Resend y OpenRouter
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const openrouter = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

// 3. Lógica principal del Bot
async function ejecutarBot() {
  try {
    console.log('Buscando contactos pendientes en Supabase...');

    // Traemos los contactos pendientes que tengan email
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

      // A) Pedimos la propuesta a la IA
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

      // B) Enviamos el correo con Resend
      const emailResult = await resend.emails.send({
        from: 'onboarding@resend.dev', // O tu dominio si ya lo configuraste
        to: contacto.email,
        subject: `Propuesta de automatización para ${contacto.nombre}`,
        text: mensajeIA
      });

      console.log(`Mail enviado con éxito a ${contacto.email}! ID:`, emailResult.id);

      // C) Cambiamos el estado en Supabase para no volver a escribirle
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

// Mantener el proceso vivo en caso de errores insólitos
process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', err);
});
