console.log("Bot de TurnoDirecto listo para operar!");
const http = require('http');

// 1. Servidor HTTP básico para que Render no tire error de "Exited early"
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Bot de TurnoDirecto en vivo y corriendo!\n');
});

server.listen(port, () => {
  console.log(`Servidor HTTP activo en el puerto ${port}`);
  console.log('Bot de TurnoDirecto listo para operar!');
});

// 2. Mantener el proceso vivo en segundo plano
process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', err);
});
