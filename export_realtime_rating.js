import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { expect, devices } from '@playwright/test';
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
const USE_MOBILE = process.env.USE_MOBILE === 'true';
const NEUTRAL_LOGIN_URL = process.env.NEUTRAL_LOGIN_URL || "https://accounts.google.com/";

const VIEWPORT = { 
    width: parseInt(process.env.VIEWPORT_WIDTH) || 1568, 
    height: parseInt(process.env.VIEWPORT_HEIGHT) || 900 
};

// Yardımcı: Rastgele bekleme
const randomDelay = (min = 500, max = 2000) => 
    new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * (max - min + 1) + min)));

/**
 * İnsan benzeri tıklama simülasyonu
 */
async function humanClick(page, locator) {
    const element = await locator.first();
    const box = await element.boundingBox();
    if (!box) {
        await element.click();
        return;
    }
    const x = box.x + box.width * (0.2 + Math.random() * 0.6);
    const y = box.y + box.height * (0.2 + Math.random() * 0.6);
    await page.mouse.move(x, y, { steps: 10 + Math.floor(Math.random() * 10) });
    await randomDelay(100, 300);
    await page.mouse.down();
    await randomDelay(50, 150);
    await page.mouse.up();
}

/**
 * Google'a en güvenli şekilde (Side-door/Neutral sayfa üzerinden) giriş yapar.
 */
async function ensureGoogleLogin(page) {
    console.log(`[i] Giriş durumu kontrol ediliyor (Hedef: ${NEUTRAL_LOGIN_URL})...`);
    await page.goto(NEUTRAL_LOGIN_URL, { waitUntil: 'networkidle' });
    await randomDelay(1000, 2000);

    // Giriş butonunu bul ve tıkla (Eğer sayfada varsa)
    const loginSelectors = [
        'a[href*="ServiceLogin"]', 
        'a:has-text("Sign in")', 
        'a:has-text("Oturum aç")',
        '#gb_70'
    ];

    for (const selector of loginSelectors) {
        try {
            const btn = page.locator(selector).first();
            if (await btn.isVisible()) {
                console.log("[i] Giriş butonu bulundu, tıklanıyor...");
                await humanClick(page, btn);
                await page.waitForNavigation();
                break;
            }
        } catch (e) {}
    }

    // Eğer giriş yapılmamışsa (Login sayfasındaysak)
    if (page.url().includes("ServiceLogin") || page.url().includes("identifier")) {
        console.log("[i] Google Oturumu kapalı. Giriş yapılıyor...");
        
        try {
            // Email
            const emailInput = page.locator('input[type="email"]');
            await emailInput.pressSequentially(EMAIL, { delay: 100 + Math.random() * 100 });
            await randomDelay(800, 1500);
            await humanClick(page, page.locator('#identifierNext'));
            
            // Password
            await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 30000 });
            await randomDelay(1500, 2500);
            
            const passInput = page.locator('input[type="password"]');
            await passInput.pressSequentially(PASSWORD, { delay: 100 + Math.random() * 100 });
            await randomDelay(1000, 2000);
            await humanClick(page, page.locator('#passwordNext'));
            
            console.log("[i] Giriş bilgileri gönderildi. Yönlendirme bekleniyor...");
            // Login sonrası herhangi bir Google sayfasına (veya yönlendiği yere) ulaşmasını bekle
            await page.waitForFunction(() => !window.location.href.includes('signin/v2'), { timeout: 60000 });
            console.log("[✓] Google girişi başarılı.");
        } catch (error) {
            console.log("[!] Otomatik giriş başarısız veya 2FA gerekli. Lütfen manuel müdahale edin.");
            await page.waitForTimeout(10000); // Kullanıcıya bakması için süre ver
        }
    } else {
        console.log("[✓] Zaten giriş yapılmış.");
    }
}

/**
 * Tek bir Looker Studio sayfasını dışa aktarır.
 */
async function exportSinglePage(page, url) {
    console.log(`\n[i] Rapor açılıyor: ${url}`);
    
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await randomDelay(3000, 5000);

        // Eğer hala giriş ekranına atarsa (Login warmup işe yaramadıysa)
        if (page.url().includes("accounts.google.com")) {
            console.log("[!] Rapor sayfası girişe yönlendirdi. Warmup yetersiz kalmış olabilir.");
            return;
        }

        console.log("[i] Tablonun yüklenmesi bekleniyor...");
        await expect(page.getByText(/pandora_vendor_name_area|Vendor Name|Satıcı Adı/i).first()).toBeVisible({ timeout: 60000 });
        await randomDelay(2000, 4000);

        console.log("[i] Tabloya sağ tıklanıyor...");
        const tableCell = page.getByText(/pandora_vendor_name_area|Vendor Name|Arby's/i).last();
        await tableCell.scrollIntoViewIfNeeded();
        await randomDelay(1000, 2000);
        
        await tableCell.click({ button: 'right' });

        await randomDelay(1500, 2500);
        console.log("[i] 'Export Chart' menüsüne tıklanıyor...");
        await humanClick(page, page.getByText(/Grafiği dışa aktar|Export chart|Export graph/i).first());

        await randomDelay(1000, 2000);
        console.log("[i] 'Export data' seçeneğine tıklanıyor...");
        await humanClick(page, page.getByText(/Verileri dışa aktar|Export data/i).first());

        await randomDelay(1000, 2000);
        console.log("[i] 'CSV (Excel)' seçeneği işaretleniyor...");
        await humanClick(page, page.getByText(/CSV \(Excel\)/i).first());

        await randomDelay(1000, 2000);
        console.log("[i] 'Export' butonuna tıklanıyor ve indirme bekleniyor...");
        const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
        await humanClick(page, page.getByRole('button', { name: /Dışa aktar|Export/i }));

        const download = await downloadPromise;
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

async function exportAllReports(headless = false) {
    if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

    if (REPORT_URLS.length === 0 || !REPORT_URLS[0]) {
        console.error("[!] Hata: .env dosyasında REPORT_URLS tanımlanmamış.");
        return;
    }

    // Cihaz ayarları (Mobil veya Masaüstü)
    const deviceProfile = USE_MOBILE ? devices['Pixel 5'] : {};
    
    const winUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const macUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
    const selectedUA = USE_MOBILE ? deviceProfile.userAgent : (process.platform === 'win32' ? winUA : macUA);
    const selectedPlatform = USE_MOBILE ? deviceProfile.platform : (process.platform === 'win32' ? 'Win32' : 'MacIntel');

    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        ...deviceProfile,
        headless: headless,
        slowMo: SLOW_MO,
        channel: 'chrome',
        acceptDownloads: true,
        viewport: USE_MOBILE ? deviceProfile.viewport : VIEWPORT,
        userAgent: selectedUA,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process",
            "--disable-infobars",
            `--window-size=${USE_MOBILE ? deviceProfile.viewport.width : VIEWPORT.width},${USE_MOBILE ? deviceProfile.viewport.height : VIEWPORT.height}`
        ],
    });

    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT);

    // Ultimate Stealth: Fingerprint Tutarlılığı
    await page.addInitScript((platform) => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'platform', { get: () => platform });
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        Object.defineProperty(navigator, 'vendor', { get: () => 'Google Inc.' });
        window.outerWidth = window.innerWidth + 16;
        window.outerHeight = window.innerHeight + 80;
        window.chrome = { runtime: {} };
    }, selectedPlatform);

    try {
        // 1) Warmup: Side-door (Neutral) sayfa üzerinden giriş
        await ensureGoogleLogin(page);
        await randomDelay(2000, 4000);

        // 2) Raporları işle
        for (const url of REPORT_URLS) {
            await exportSinglePage(page, url);
        }
    } finally {
        await context.close();
        console.log("\n[✓] Tüm işlemler tamamlandı.");
    }
}

exportAllReports(IS_HEADLESS).catch((err) => {
    console.error("Script durduruldu.");
    process.exit(1);
});
