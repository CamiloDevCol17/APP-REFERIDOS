const express = require('express');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const TARGET_URL = 'https://employeereferral.talkpush.com/refer/concentrix_colombia3000077';
const DB_FILE = path.join(__dirname, 'ya-aplicaron.json');

function leerDB() {
  if (!fs.existsSync(DB_FILE)) return [];
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
}
function guardarEnDB(registro) {
  const data = leerDB();
  data.push({ ...registro, fecha: new Date().toISOString() });
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

app.post('/api/referir', async (req, res) => {
  const { nombre, apellido, telefono, correo } = req.body;

  if (!nombre || !apellido || !correo) {
    return res.status(400).json({ ok: false, mensaje: 'Faltan campos obligatorios' });
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });

    // Paso 1: seleccionar posición
    await page.waitForSelector('button.campaign-card[data-id="1044"]', { timeout: 30000 });
    await page.click('button.campaign-card[data-id="1044"]');

    // Paso 2: formulario
    await page.waitForSelector('input[name="candidateFirstName"]', { timeout: 30000 });
    await page.fill('input[name="candidateFirstName"]', nombre);
    await page.fill('input[name="candidateLastName"]', apellido);
    await page.fill('input[name="candidateEmail"]', correo);

    if (telefono) {
      const telInput = page.locator('input[name="candidatePhone"]');
      if (await telInput.count() > 0) await telInput.fill(telefono);
    }

    await page.selectOption('select[name="custom_ciudad_del_referido"]', 'Bogotá');
    await page.selectOption('select[name="custom_cuenta_referido"]', 'Any Campaign Bilingual (Bonus $600 COP)');
    await page.selectOption('select[name="custom_a03_idioma_cuenta_empleado"]', 'Bilingue');

    const checkbox = page.locator('input.terms-agree-checkbox');
    if (!(await checkbox.isChecked())) await checkbox.check();

    // Clic en "Enviar Referido" -> abre modal de términos
    await page.click('button.opens-terms-modal');

    // Esperar modal y clic en "Continuar"
    await page.waitForSelector('#termsModalContinueBtn', { timeout: 15000 });
    await page.click('#termsModalContinueBtn');

    // Esperar respuesta del sitio (éxito o mensaje de duplicado)
    await page.waitForTimeout(4000);
    const bodyText = await page.textContent('body');

    const yaAplico = bodyText.includes('ya fue invitado a postularse anteriormente');

    await browser.close();

    const registro = { nombre, apellido, correo, telefono: telefono || '' };

    if (yaAplico) {
      guardarEnDB(registro);
      return res.json({
        ok: true,
        duplicado: true,
        mensaje: 'Este candidato ya fue invitado a postularse anteriormente'
      });
    }

    return res.json({ ok: true, duplicado: false, mensaje: 'REFERIDO SUBIDO EXITOSAMENTE' });

  } catch (error) {
    if (browser) await browser.close();
    console.error(error);
    return res.status(500).json({ ok: false, mensaje: 'Error: ' + error.message });
  }
});

// Endpoint para consultar la tabla de "Ya Aplicaron"
app.get('/api/ya-aplicaron', (req, res) => {
  res.json(leerDB());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`App corriendo en http://localhost:${PORT}`));