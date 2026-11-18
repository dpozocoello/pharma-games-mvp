import { expect, test } from '@playwright/test';

const API_URL = process.env.API_BASE_URL ?? 'http://localhost:3000';
const ADMIN_URL = process.env.ADMIN_BASE_URL ?? 'http://localhost:5174';

async function peekDevOtp(phone: string): Promise<string> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const res = await fetch(`${API_URL}/api/v1/dev/outbox`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    if (res.ok) {
      const data = (await res.json()) as { code: string | null };
      if (data.code) return data.code;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`No llegó código OTP para ${phone}`);
}

test.describe('Iteración 1 — Entrada única, OTP, consentimiento y país fijado', () => {
  test('el dependiente elige Perú, ingresa con OTP, acepta consentimiento y ve su país fijado', async ({
    page,
  }) => {
    const clerkPhone = '+51900000001';

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Juega y aprende/i })).toBeVisible();

    // Verifica objetivo táctil >= 44px en botón de país
    const peBtn = page.getByRole('button', { name: 'Perú' });
    await expect(peBtn).toBeVisible();
    const box = await peBtn.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await peBtn.click();

    // Paso 1: Solicitar OTP
    const input = page.getByLabel(/Número de celular/i);
    await input.fill('900000001');
    await page.getByRole('button', { name: /Recibir código/i }).click();

    // Paso 2: Ingresar código OTP de 6 dígitos
    const otpInput = page.getByLabel(/Código de 6 dígitos/i);
    await expect(otpInput).toBeVisible();
    const code = await peekDevOtp(clerkPhone);
    await otpInput.fill(code);
    await page.getByRole('button', { name: /Ingresar/i }).click();

    // Paso 3: Si aún no aceptó consentimiento en esta ejecución, lo acepta
    const consentBtn = page.getByRole('button', { name: /Acepto y continuar/i });
    if (await consentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await consentBtn.click();
    }

    // Paso 4: Pantalla principal con país fijado y sesión persistente tras recargar
    await expect(page.getByText(/Perú \(PE\) — fijado a tu cuenta/i)).toBeVisible();
    await page.reload();
    await expect(page.getByText(/Perú \(PE\) — fijado a tu cuenta/i)).toBeVisible();
  });

  test('COUNTRY_ADMIN de Perú entra al panel, solo ve Perú y actualiza reglas sin desplegar', async ({
    page,
  }) => {
    const adminPhone = '+51900000091';

    await page.goto(ADMIN_URL);
    await expect(page.getByRole('heading', { name: /Administración/i })).toBeVisible();

    await page.getByLabel(/Celular con prefijo internacional/i).fill(adminPhone);
    await page.getByRole('button', { name: /Solicitar código OTP/i }).click();

    const code = await peekDevOtp(adminPhone);
    await page.getByLabel(/Código de 6 dígitos/i).fill(code);
    await page.getByRole('button', { name: /Entrar al panel/i }).click();

    // Verifica que ve Perú y no ve Colombia ni Ecuador en su barra lateral
    const aside = page.getByRole('complementary', { name: /Países en tu alcance/i });
    await expect(aside.getByRole('button', { name: /Perú \(PE\)/i })).toBeVisible();
    await expect(aside.getByRole('button', { name: /Colombia \(CO\)/i })).toHaveCount(0);
    await expect(aside.getByRole('button', { name: /Ecuador \(EC\)/i })).toHaveCount(0);

    // Guarda configuración sin desplegar
    await page.getByRole('button', { name: /Guardar configuración/i }).click();
    await expect(
      page.getByText(/Configuración actualizada y caché invalidada sin desplegar/i),
    ).toBeVisible();
  });
});
