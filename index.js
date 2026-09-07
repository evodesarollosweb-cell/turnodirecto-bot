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
