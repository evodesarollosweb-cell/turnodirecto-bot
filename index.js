const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

// Función para encontrar el ejecutable de Chrome descargado en Render
function obtenerRutaChrome() {
  try {
    return puppeteer.executablePath();
  } catch (e) {
    // Si falla la detección automática, busca la carpeta descargada en el caché
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
