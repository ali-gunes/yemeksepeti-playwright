import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Stealth pluginini aktif et
chromium.use(stealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORT_URL = "https://datastudio.google.com/u/0/reporting/ac9c2e68-bd1f-4f3c-82aa-21cdc8fe50b5/page/p_6agkl7j1md?s=nICzxp495F4";
const USER_DATA_DIR = path.join(__dirname, 'auth_state');
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');

// Credentials
const EMAIL = "channelinfoc@gmail.com";
const PASSWORD = "i57sqUi15jkq5uvV";

// Yardımcı: Rastgele bekleme (insan taklidi için)
const randomDelay = (min = 500, max = 2000) => 
    new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));

/**
 * Real-Time Rating tablosunu CSV (Excel) formatında dışa aktarır.
 * @param {boolean} headless - Tarayıcının görünür olup olmayacağı.
 */
async function exportRealtimeRatingCsv(headless = false) {
    if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    console.log("[i] Tarayıcı başlatılıyor (Stealth mode aktif)...");
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: headless,
        acceptDownloads: true,
        viewport: { width: 1568, height: 900 },
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        args: [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-setuid-sandbox"
        ],
    });

    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    try {
        // 1) Rapora git
        console.log("[i] Rapora gidiliyor...");
        await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded' });
        await randomDelay(2000, 4000);

        // Eğer Google login ekranı çıkarsa otomatik giriş yapmayı dene
        if (page.url().includes("accounts.google.com")) {
            console.log("[i] Google girişi gerekli. Otomatik giriş yapılıyor...");
            
            try {
                // Email girişi (yavaş yazım simülasyonu)
                await page.locator('input[type="email"]').pressSequentially(EMAIL, { delay: 100 });
                await randomDelay(800, 1500);
                await page.click('#identifierNext');
                
                // Şifre alanının görünmesini bekle
                await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 30000 });
                await randomDelay(1000, 2000);
                
                // Şifre girişi
                await page.locator('input[type="password"]').pressSequentially(PASSWORD, { delay: 100 });
                await randomDelay(800, 1500);
                await page.click('#passwordNext');
                
                console.log("[i] Giriş bilgileri gönderildi. Yönlendirme bekleniyor...");
            } catch (loginError) {
                console.log("[!] Otomatik giriş sırasında hata oluştu veya manuel müdahale gerekiyor: " + loginError.message);
                console.log("[i] Lütfen tarayıcıda manuel giriş yapın...");
            }

            // Raporun yüklenmesini bekle
            await page.waitForURL("**/datastudio.google.com/**", { timeout: 300000 });
        }

        // 2) Real-Time Rating sekmesine geç
        try {
            await randomDelay(2000, 3000);
            await page.getByText("Real-Time Rating", { exact: true }).first().click({ timeout: 10000 });
        } catch (e) {
            // Zaten sayfada olabiliriz
        }

        // 3) Tablonun yüklenmesini bekle
        console.log("[i] Tablonun yüklenmesi bekleniyor...");
        await expect(page.getByText(/Vendor Name|Satıcı Adı/i).first()).toBeVisible({ timeout: 60000 });
        await randomDelay(2000, 4000);

        // 4) Tablonun ortasına sağ tıkla
        console.log("[i] Tabloya sağ tıklanıyor...");
        const tableCell = page.getByText("Arby's").first();
        await tableCell.scrollIntoViewIfNeeded();
        await randomDelay(1000, 2000);
        
        await tableCell.click();
        await randomDelay(500, 1000);
        await tableCell.click({ button: 'right' });
        console.log("[i] Sağ tık yapıldı, menü bekleniyor...");

        // 5) "Grafiği dışa aktar..." menüsüne tıkla
        await randomDelay(1500, 2500);
        console.log("[i] 'Export Chart / Grafiği dışa aktar' menüsüne tıklanıyor...");
        await page.getByText(/Grafiği dışa aktar|Export chart|Export graph/i).first().click();

        // 6) Alt menüden "Verileri dışa aktar" seçeneğine tıkla
        await randomDelay(1000, 2000);
        console.log("[i] 'Export data / Verileri dışa aktar' seçeneğine tıklanıyor...");
        await page.getByText(/Verileri dışa aktar|Export data/i).first().click();

        // 7) Açılan diyalogda "CSV (Excel)" seçeneğini işaretle
        await randomDelay(1000, 2000);
        console.log("[i] 'CSV (Excel)' seçeneği işaretleniyor...");
        await page.getByText(/CSV \(Excel\)/i).first().click();

        // 8) "Dışa aktar" butonuna tıkla ve indirmeyi yakala
        await randomDelay(1000, 2000);
        console.log("[i] 'Export / Dışa aktar' butonuna tıklanıyor ve indirme bekleniyor...");
        const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
        await page.getByRole('button', { name: /Dışa aktar|Export/i }).click();

        const download = await downloadPromise;
        const suggestedName = download.suggestedFilename() || "real_time_rating.csv";
        const targetPath = path.join(DOWNLOAD_DIR, suggestedName);
        await download.saveAs(targetPath);
        
        console.log(`[✓] İndirilen dosya: ${targetPath}`);
        return targetPath;
    } catch (error) {
        console.error(`[!] Hata oluştu: ${error.message}`);
        throw error;
    } finally {
        await context.close();
    }
}

// headless=false olduğunda tarayıcı görünür ve gerekirse Google girişi yapılabilir
exportRealtimeRatingCsv(false).catch((err) => {
    console.error("Script durduruldu.");
    process.exit(1);
});
