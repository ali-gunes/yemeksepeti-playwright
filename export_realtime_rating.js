import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import 'dotenv/config';

// Stealth pluginini aktif et
chromium.use(stealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration from .env
const REPORT_URLS = (process.env.REPORT_URLS || "").split(',').map(url => url.trim());
const USER_DATA_DIR = path.join(__dirname, process.env.AUTH_STATE_DIR || 'auth_state');
const DOWNLOAD_DIR = path.join(__dirname, process.env.DOWNLOAD_DIR || 'downloads');
const EMAIL = process.env.GOOGLE_EMAIL;
const PASSWORD = process.env.GOOGLE_PASSWORD;
const IS_HEADLESS = process.env.HEADLESS === 'true';
const SLOW_MO = parseInt(process.env.SLOW_MO) || 0;
const TIMEOUT = parseInt(process.env.DEFAULT_TIMEOUT) || 60000;
const VIEWPORT = { 
    width: parseInt(process.env.VIEWPORT_WIDTH) || 1568, 
    height: parseInt(process.env.VIEWPORT_HEIGHT) || 900 
};

// Yardımcı: Rastgele bekleme (insan taklidi için)
const randomDelay = (min = 500, max = 2000) => 
    new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));

/**
 * Tek bir Looker Studio sayfasını dışa aktarır.
 */
async function exportSinglePage(page, url) {
    console.log(`\n[i] İşleniyor: ${url}`);
    
    try {
        // 1) Sayfaya git
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await randomDelay(2000, 4000);

        // Eğer Google login ekranı çıkarsa otomatik giriş yapmayı dene
        if (page.url().includes("accounts.google.com")) {
            console.log("[i] Google girişi gerekli. Otomatik giriş yapılıyor...");
            
            try {
                await page.locator('input[type="email"]').pressSequentially(EMAIL, { delay: 100 });
                await randomDelay(800, 1500);
                await page.click('#identifierNext');
                
                await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 30000 });
                await randomDelay(1000, 2000);
                
                await page.locator('input[type="password"]').pressSequentially(PASSWORD, { delay: 100 });
                await randomDelay(800, 1500);
                await page.click('#passwordNext');
                
                console.log("[i] Giriş bilgileri gönderildi. Yönlendirme bekleniyor...");
            } catch (loginError) {
                console.log("[!] Otomatik giriş hatası (manuel müdahale gerekebilir): " + loginError.message);
            }

            await page.waitForURL("**/datastudio.google.com/**", { timeout: 300000 });
            // Giriş sonrası sayfanın tam yüklenmesi için tekrar bekle
            await page.goto(url, { waitUntil: 'domcontentloaded' });
        }

        // 2) Tablonun yüklenmesini bekle
        console.log("[i] Tablonun yüklenmesi bekleniyor...");
        // Sayfada hem Vendor Name hem de pandora_vendor_name_area olabilir, herhangi birini bekleyelim
        await expect(page.getByText(/pandora_vendor_name_area|Vendor Name|Satıcı Adı/i).first()).toBeVisible({ timeout: 60000 });
        await randomDelay(2000, 4000);

        // 3) Tabloya sağ tıkla
        console.log("[i] Tabloya sağ tıklanıyor...");
        // .last() kullanarak sayfanın üstündeki grafikler yerine alttaki tabloyu hedefliyoruz
        const tableCell = page.getByText(/pandora_vendor_name_area|Vendor Name|Arby's/i).last();
        await tableCell.scrollIntoViewIfNeeded();
        await randomDelay(1000, 2000);
        
        await tableCell.click();
        await randomDelay(500, 1000);
        await tableCell.click({ button: 'right' });

        // 4) Menüden dışa aktarma adımları
        await randomDelay(1500, 2500);
        console.log("[i] 'Export Chart / Grafiği dışa aktar' menüsüne tıklanıyor...");
        await page.getByText(/Grafiği dışa aktar|Export chart|Export graph/i).first().click();

        await randomDelay(1000, 2000);
        console.log("[i] 'Export data / Verileri dışa aktar' seçeneğine tıklanıyor...");
        await page.getByText(/Verileri dışa aktar|Export data/i).first().click();

        await randomDelay(1000, 2000);
        console.log("[i] 'CSV (Excel)' seçeneği işaretleniyor...");
        await page.getByText(/CSV \(Excel\)/i).first().click();

        // 5) İndirmeyi başlat ve yakala
        await randomDelay(1000, 2000);
        console.log("[i] 'Export / Dışa aktar' butonuna tıklanıyor ve indirme bekleniyor...");
        const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
        await page.getByRole('button', { name: /Dışa aktar|Export/i }).click();

        const download = await downloadPromise;
        
        // YYYY-MM-DD_HH-mm-ss formatında zaman damgası oluştur
        const now = new Date();
        const timestamp = now.toISOString().split('T')[0] + '_' + 
                          now.getHours().toString().padStart(2, '0') + '-' + 
                          now.getMinutes().toString().padStart(2, '0') + '-' + 
                          now.getSeconds().toString().padStart(2, '0');
                          
        const suggestedName = download.suggestedFilename() || "export.csv";
        const finalName = `${timestamp}_${suggestedName}`;
        
        const targetPath = path.join(DOWNLOAD_DIR, finalName);
        await download.saveAs(targetPath);
        
        console.log(`[✓] Başarıyla indirildi: ${finalName}`);
        return targetPath;

    } catch (error) {
        console.error(`[!] ${url} işlenirken hata oluştu: ${error.message}`);
    }
}

/**
 * Tüm raporları sırayla dışa aktarır.
 */
async function exportAllReports(headless = false) {
    if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    if (REPORT_URLS.length === 0 || !REPORT_URLS[0]) {
        console.error("[!] Hata: .env dosyasında REPORT_URLS tanımlanmamış.");
        return;
    }

    console.log(`[i] Toplam ${REPORT_URLS.length} rapor işlenecek.`);
    
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: headless,
        slowMo: SLOW_MO,
        acceptDownloads: true,
        viewport: VIEWPORT,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        args: [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-setuid-sandbox"
        ],
    });

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT);

    try {
        for (const url of REPORT_URLS) {
            await exportSinglePage(page, url);
        }
    } finally {
        await context.close();
        console.log("\n[✓] Tüm işlemler tamamlandı.");
    }
}

// .env dosyasındaki HEADLESS değerine göre başlatır
exportAllReports(IS_HEADLESS).catch((err) => {
    console.error("Script durduruldu.");
    process.exit(1);
});
