"""
Looker Studio - TAB Gıda Rating & Review
Real-Time Rating sekmesindeki tablonun verilerini CSV (Excel) formatında dışa aktarır.

Kurulum:
    pip install playwright
    playwright install chromium

Çalıştırma:
    python export_realtime_rating.py

Notlar:
- Google hesap girişi gerektirdiği için ilk çalıştırmada tarayıcıda manuel
  giriş yapmanız gerekir. Oturum bilgisi 'auth_state' klasöründe saklanır,
  sonraki çalıştırmalarda otomatik kullanılır.
- İndirilen dosya, scriptin bulunduğu klasördeki 'downloads' altına kaydedilir.
"""

from pathlib import Path
from playwright.sync_api import sync_playwright, expect

REPORT_URL = (
    "https://datastudio.google.com/u/0/reporting/"
    "ac9c2e68-bd1f-4f3c-82aa-21cdc8fe50b5/page/p_6agkl7j1md?s=nICzxp495F4"
)

# Oturum (cookie/storage) bilgilerinin saklanacağı dizin
USER_DATA_DIR = Path(__file__).parent / "auth_state"
DOWNLOAD_DIR = Path(__file__).parent / "downloads"


def export_realtime_rating_csv(headless: bool = False) -> Path:
    """Real-Time Rating tablosunu CSV (Excel) formatında dışa aktarır.

    Returns:
        İndirilen CSV dosyasının yolunu döner.
    """
    USER_DATA_DIR.mkdir(parents=True, exist_ok=True)
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        # Persistent context: Google girişini bir kez yapıp saklamak için
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(USER_DATA_DIR),
            headless=headless,
            accept_downloads=True,
            viewport={"width": 1568, "height": 900},
            args=["--disable-blink-features=AutomationControlled"],
        )

        page = context.new_page()
        page.set_default_timeout(60_000)

        # 1) Rapora git
        page.goto(REPORT_URL, wait_until="domcontentloaded")

        # Eğer Google login ekranı çıkarsa kullanıcının manuel giriş yapmasını bekle
        if "accounts.google.com" in page.url:
            print(
                "[i] Google girişi gerekli. Lütfen tarayıcıda giriş yapın. "
                "Rapor yüklendikten sonra script otomatik devam edecek..."
            )
            page.wait_for_url("**/datastudio.google.com/**", timeout=300_000)

        # 2) Real-Time Rating sekmesine geç (URL zaten o sayfaya gidiyor,
        #    yine de güvence olarak sol menüden tıklıyoruz)
        try:
            page.get_by_text("Real-Time Rating", exact=True).first.click(timeout=10_000)
        except Exception:
            pass  # Sayfa zaten Real-Time Rating ise tıklamaya gerek yok

        # 3) Tablonun yüklenmesini bekle ("Vendor Name" başlığı görünene kadar)
        expect(page.get_by_text("Vendor Name", exact=False).first).to_be_visible(
            timeout=60_000
        )
        page.wait_for_timeout(2000)  # render için ek bekleme

        # 4) Tablonun ortasına sağ tıkla -> bağlam menüsü açılır
        # Tablonun bir hücresini hedeflemek en güvenilir yöntem
        table_cell = page.get_by_text("Arby's").first
        table_cell.scroll_into_view_if_needed()
        table_cell.click(button="right")

        # 5) "Grafiği dışa aktar..." menüsüne tıkla
        page.get_by_text("Grafiği dışa aktar", exact=False).click()

        # 6) Alt menüden "Verileri dışa aktar" seçeneğine tıkla
        page.get_by_text("Verileri dışa aktar", exact=False).click()

        # 7) Açılan diyalogda "CSV (Excel)" seçeneğini işaretle
        page.get_by_text("CSV (Excel)", exact=False).click()

        # 8) "Dışa aktar" butonuna tıkla ve indirmeyi yakala
        with page.expect_download(timeout=120_000) as download_info:
            page.get_by_role("button", name="Dışa aktar").click()

        download = download_info.value
        suggested = download.suggested_filename or "real_time_rating.csv"
        target_path = DOWNLOAD_DIR / suggested
        download.save_as(str(target_path))
        print(f"[✓] İndirilen dosya: {target_path}")

        context.close()
        return target_path


if __name__ == "__main__":
    # headless=False olduğunda tarayıcı görünür ve gerekirse Google girişi yapılabilir
    export_realtime_rating_csv(headless=False)